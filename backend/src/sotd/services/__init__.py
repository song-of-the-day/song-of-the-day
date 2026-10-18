"""Business logic. Services take explicit arguments and never read ``flask.request``.

The one exception is the request glue in :mod:`sotd.services.sessions` (``log_in``,
``log_out``, ``current_account``, ...), which binds server-side sessions to the current
request's cookies through Flask-Login.
"""
