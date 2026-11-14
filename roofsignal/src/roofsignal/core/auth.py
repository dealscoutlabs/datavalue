"""Staff accounts and sessions. Passwords: argon2id. Session tokens: random, only their SHA-256 is stored."""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from sqlalchemy import select
from sqlalchemy.orm import Session

from roofsignal.core.settings import get_settings
from roofsignal.db.models import AppUser, UserSession

ROLES = ("admin", "supervisor", "agent")
_ph = PasswordHasher()
_DUMMY_HASH = _ph.hash("timing-equalizer")


def hash_password(pw: str) -> str:
    if len(pw) < 12:
        raise ValueError("passwords must be at least 12 characters")
    return _ph.hash(pw)


def create_user(s: Session, email: str, display_name: str, role: str, password: str) -> AppUser:
    if role not in ROLES:
        raise ValueError(f"role must be one of {ROLES}")
    user = AppUser(email=email.strip().lower(), display_name=display_name, role=role,
                   password_hash=hash_password(password))
    s.add(user)
    s.flush()
    return user


def _sha(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def login(s: Session, email: str, password: str, ip: str | None = None) -> tuple[AppUser, str] | None:
    user = s.scalar(select(AppUser).where(AppUser.email == email.strip().lower()))
    try:
        _ph.verify(user.password_hash if user else _DUMMY_HASH, password)
    except (VerifyMismatchError, InvalidHashError):
        return None
    if user is None or not user.active:
        return None
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    s.add(UserSession(user_id=user.id, token_sha256=_sha(token), expires_at=now + timedelta(
        hours=get_settings().session_hours), ip=ip))
    user.last_login_at = now
    s.flush()
    return user, token


def user_for_token(s: Session, token: str) -> AppUser | None:
    sess = s.scalar(select(UserSession).where(UserSession.token_sha256 == _sha(token)))
    now = datetime.now(timezone.utc)
    if sess is None or sess.revoked_at is not None or sess.expires_at <= now:
        return None
    user = s.get(AppUser, sess.user_id)
    return user if user and user.active else None


def logout(s: Session, token: str) -> None:
    sess = s.scalar(select(UserSession).where(UserSession.token_sha256 == _sha(token)))
    if sess and sess.revoked_at is None:
        sess.revoked_at = datetime.now(timezone.utc)
