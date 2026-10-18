"""Outgoing email.

:func:`send_email` delivers a plain-text message through the backend named by
``MAIL_BACKEND``:

* ``smtp``: ``smtplib.SMTP`` upgraded with STARTTLS (``MAIL_USE_TLS``) or ``SMTP_SSL``
  (``MAIL_USE_SSL``), both with a certificate- and hostname-verifying TLS context and a
  ``MAIL_TIMEOUT`` socket timeout. Plaintext SMTP is refused in production.
* ``console``: development; the message is logged.
* ``memory``: tests; the message is appended to ``app.extensions["mail_outbox"]``.

The ``To:`` header always holds the bare address, never a display name.
"""

from __future__ import annotations

import logging
import smtplib
import ssl
from dataclasses import dataclass
from email.message import EmailMessage
from typing import Final

from flask import Config, current_app

logger = logging.getLogger(__name__)

#: ``app.extensions`` key of the in-memory outbox used by the ``memory`` backend.
OUTBOX_EXTENSION_KEY: Final = "mail_outbox"


class MailError(Exception):
    """The message could not be delivered (or the mail settings forbid delivery)."""


@dataclass(frozen=True, slots=True)
class OutgoingEmail:
    """A plain-text email as handed to a backend.

    Attributes:
        to: The recipient's bare address.
        subject: The subject line.
        text: The plain-text body.
    """

    to: str
    subject: str
    text: str


def send_email(to: str, subject: str, text: str) -> None:
    """Send a plain-text email with the configured backend.

    Must run within an application context.

    Args:
        to: The recipient's address (used bare in the ``To:`` header).
        subject: The subject line.
        text: The plain-text body.

    Raises:
        MailError: If the message can't be built or delivered, or the configuration
            doesn't allow sending it.
    """
    email = OutgoingEmail(to=to, subject=subject, text=text)
    backend = current_app.config["MAIL_BACKEND"]
    if backend == "memory":
        outbox: list[OutgoingEmail] = current_app.extensions.setdefault(OUTBOX_EXTENSION_KEY, [])
        outbox.append(email)
    elif backend == "console":
        logger.info("Email to %s: %s\n\n%s", email.to, email.subject, email.text)
    elif backend == "smtp":
        _send_smtp(email)
    else:
        raise MailError(f"Unknown MAIL_BACKEND {backend!r}.")


def _build_message(sender: str, email: OutgoingEmail) -> EmailMessage:
    message = EmailMessage()
    try:
        message["From"] = sender
        message["To"] = email.to
        message["Subject"] = email.subject
    except ValueError as exc:  # A header value with a line break.
        raise MailError("Invalid email header.") from exc
    message.set_content(email.text)
    return message


def _send_smtp(email: OutgoingEmail) -> None:
    config = current_app.config
    host: str | None = config["MAIL_SERVER"]
    sender: str | None = config["MAIL_FROM"]
    if not (host and sender):
        raise MailError("MAIL_SERVER and MAIL_FROM must be configured.")
    use_ssl: bool = config["MAIL_USE_SSL"]
    use_tls: bool = config["MAIL_USE_TLS"]
    if not (use_ssl or use_tls) and config["APP_ENV"] == "production":
        raise MailError("Plaintext SMTP is refused in production.")

    message = _build_message(sender, email)
    port: int = config["MAIL_PORT"]
    timeout: float = config["MAIL_TIMEOUT"]
    context = ssl.create_default_context()
    try:
        connection: smtplib.SMTP
        if use_ssl:
            connection = smtplib.SMTP_SSL(host, port, timeout=timeout, context=context)
        else:
            connection = smtplib.SMTP(host, port, timeout=timeout)
        with connection:
            if use_tls and not use_ssl:
                connection.starttls(context=context)
            _login(connection, config)
            connection.send_message(message)
    except (smtplib.SMTPException, OSError) as exc:
        raise MailError(f"SMTP delivery failed ({type(exc).__name__}).") from exc


def _login(connection: smtplib.SMTP, config: Config) -> None:
    username: str | None = config["MAIL_USERNAME"]
    if username:
        connection.login(username, config["MAIL_PASSWORD"] or "")
