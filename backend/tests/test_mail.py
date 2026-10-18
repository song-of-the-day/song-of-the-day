"""Mail backends (``sotd.services.mail``)."""

from __future__ import annotations

import logging
import smtplib
import ssl
from collections.abc import Iterator
from email.message import EmailMessage
from typing import Any, ClassVar

import pytest
from flask import Flask

from sotd.services.mail import OUTBOX_EXTENSION_KEY, MailError, OutgoingEmail, send_email

SMTP_SETTINGS: dict[str, Any] = {
    "MAIL_BACKEND": "smtp",
    "MAIL_SERVER": "smtp.example.com",
    "MAIL_PORT": 587,
    "MAIL_FROM": "Song of the Day <hello@sotd.ca>",
    "MAIL_USE_TLS": True,
    "MAIL_USE_SSL": False,
    "MAIL_USERNAME": None,
    "MAIL_PASSWORD": None,
    "MAIL_TIMEOUT": 7.5,
}


class FakeSMTP:
    """Records what ``sotd.services.mail`` does with an SMTP connection."""

    instances: ClassVar[list[FakeSMTP]] = []
    fail_on: ClassVar[str | None] = None

    def __init__(self, host: str, port: int, *, timeout: float, **kwargs: Any) -> None:
        self.host, self.port, self.timeout, self.kwargs = host, port, timeout, kwargs
        self.calls: list[tuple[str, Any]] = []
        self.closed = False
        FakeSMTP.instances.append(self)

    def __enter__(self) -> FakeSMTP:
        return self

    def __exit__(self, *_exc: object) -> None:
        self.closed = True

    def _record(self, name: str, value: Any = None) -> None:
        if FakeSMTP.fail_on == name:
            raise smtplib.SMTPServerDisconnected("Connection unexpectedly closed")
        self.calls.append((name, value))

    def starttls(self, *, context: ssl.SSLContext) -> None:
        self._record("starttls", context)

    def login(self, user: str, password: str) -> None:
        self._record("login", (user, password))

    def send_message(self, message: EmailMessage) -> None:
        self._record("send_message", message)


class FakeSMTPSSL(FakeSMTP):
    pass


@pytest.fixture
def smtp(monkeypatch: pytest.MonkeyPatch, app: Flask) -> Iterator[type[FakeSMTP]]:
    FakeSMTP.instances = []
    FakeSMTP.fail_on = None
    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)
    monkeypatch.setattr(smtplib, "SMTP_SSL", FakeSMTPSSL)
    for key, value in SMTP_SETTINGS.items():
        monkeypatch.setitem(app.config, key, value)
    with app.app_context():
        yield FakeSMTP


def sent_message(connection: FakeSMTP) -> EmailMessage:
    [message] = [value for name, value in connection.calls if name == "send_message"]
    assert isinstance(message, EmailMessage)
    return message


def assert_verifying_context(context: object) -> None:
    assert isinstance(context, ssl.SSLContext)
    assert context.verify_mode == ssl.CERT_REQUIRED
    assert context.check_hostname is True


def test_memory_backend_appends_to_the_outbox(app: Flask, outbox: list[OutgoingEmail]) -> None:
    with app.app_context():
        send_email("ada@example.com", "Hello", "Body")
    assert outbox == [OutgoingEmail(to="ada@example.com", subject="Hello", text="Body")]
    assert app.extensions[OUTBOX_EXTENSION_KEY] is outbox


def test_console_backend_logs_the_message(
    app: Flask, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setitem(app.config, "MAIL_BACKEND", "console")
    with app.app_context(), caplog.at_level(logging.INFO, logger="sotd.services.mail"):
        send_email("ada@example.com", "Hello", "Line one\nLine two")
    assert "Email to ada@example.com: Hello\n\nLine one\nLine two" in caplog.text


def test_unknown_backend_raises(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(app.config, "MAIL_BACKEND", "pigeon")
    with app.app_context(), pytest.raises(MailError, match="Unknown MAIL_BACKEND"):
        send_email("ada@example.com", "Hello", "Body")


def test_smtp_with_starttls(smtp: type[FakeSMTP]) -> None:
    send_email("ada@example.com", "Reset your password", "Open the link.")
    [connection] = smtp.instances
    assert type(connection) is FakeSMTP
    assert (connection.host, connection.port, connection.timeout) == ("smtp.example.com", 587, 7.5)
    assert [name for name, _ in connection.calls] == ["starttls", "send_message"]
    assert_verifying_context(connection.calls[0][1])
    message = sent_message(connection)
    assert message["To"] == "ada@example.com"
    assert message["From"] == "Song of the Day <hello@sotd.ca>"
    assert message["Subject"] == "Reset your password"
    assert message.get_content() == "Open the link.\n"
    assert connection.closed


def test_smtp_over_ssl_with_login(smtp: type[FakeSMTP], app: Flask) -> None:
    app.config.update(MAIL_USE_SSL=True, MAIL_USE_TLS=False, MAIL_PORT=465)
    app.config.update(MAIL_USERNAME="mailer", MAIL_PASSWORD="app-password")
    send_email("ada@example.com", "Hello", "Body")
    [connection] = smtp.instances
    assert type(connection) is FakeSMTPSSL
    assert connection.port == 465
    assert_verifying_context(connection.kwargs["context"])
    assert [name for name, _ in connection.calls] == ["login", "send_message"]
    assert connection.calls[0][1] == ("mailer", "app-password")


def test_smtp_login_without_a_password(smtp: type[FakeSMTP], app: Flask) -> None:
    app.config["MAIL_USERNAME"] = "mailer"
    send_email("ada@example.com", "Hello", "Body")
    assert ("login", ("mailer", "")) in smtp.instances[0].calls


def test_plaintext_smtp_is_allowed_outside_production(smtp: type[FakeSMTP], app: Flask) -> None:
    app.config["MAIL_USE_TLS"] = False
    send_email("ada@example.com", "Hello", "Body")
    assert [name for name, _ in smtp.instances[0].calls] == ["send_message"]


def test_plaintext_smtp_is_refused_in_production(
    smtp: type[FakeSMTP], app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    app.config["MAIL_USE_TLS"] = False
    monkeypatch.setitem(app.config, "APP_ENV", "production")
    with pytest.raises(MailError, match="Plaintext SMTP is refused in production"):
        send_email("ada@example.com", "Hello", "Body")
    assert smtp.instances == []


@pytest.mark.parametrize("missing", ["MAIL_SERVER", "MAIL_FROM"])
def test_smtp_requires_a_server_and_sender(smtp: type[FakeSMTP], app: Flask, missing: str) -> None:
    app.config[missing] = None
    with pytest.raises(MailError, match="MAIL_SERVER and MAIL_FROM must be configured"):
        send_email("ada@example.com", "Hello", "Body")
    assert smtp.instances == []


@pytest.mark.parametrize("step", ["starttls", "send_message"])
def test_smtp_failures_raise_mail_error(smtp: type[FakeSMTP], step: str) -> None:
    smtp.fail_on = step
    with pytest.raises(MailError, match="SMTPServerDisconnected") as excinfo:
        send_email("ada@example.com", "Hello", "Body")
    assert isinstance(excinfo.value.__cause__, smtplib.SMTPException)
    assert smtp.instances[0].closed


def test_smtp_connection_errors_raise_mail_error(
    smtp: type[FakeSMTP], monkeypatch: pytest.MonkeyPatch
) -> None:
    def refuse(*_args: object, **_kwargs: object) -> None:
        raise ConnectionRefusedError(61, "Connection refused")

    monkeypatch.setattr(smtplib, "SMTP", refuse)
    with pytest.raises(MailError, match="ConnectionRefusedError"):
        send_email("ada@example.com", "Hello", "Body")


def test_header_injection_is_refused(smtp: type[FakeSMTP]) -> None:
    with pytest.raises(MailError, match="Invalid email header"):
        send_email("ada@example.com\r\nBcc: eve@example.com", "Hello", "Body")
    assert smtp.instances == []
