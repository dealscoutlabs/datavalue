from __future__ import annotations

import hmac
from collections.abc import Iterator

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from roofsignal.core.auth import user_for_token
from roofsignal.core.settings import get_settings
from roofsignal.db.models import AppUser
from roofsignal.db.session import session_factory


def get_session() -> Iterator[Session]:
    s = session_factory()()
    try:
        yield s
        s.commit()
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()


def require_service(x_service_token: str | None = Header(default=None)) -> None:
    """Every request must come from our own web server."""
    expected = get_settings().service_api_token
    if not expected:
        raise HTTPException(503, "SERVICE_API_TOKEN is not configured; refusing to serve")
    if not x_service_token or not hmac.compare_digest(x_service_token.encode(), expected.encode()):
        raise HTTPException(401, "invalid service token")


def current_user(authorization: str | None = Header(default=None), session: Session = Depends(get_session),
                 _: None = Depends(require_service)) -> AppUser:
    token = (authorization or "").removeprefix("Bearer ").strip()
    user = user_for_token(session, token) if token else None
    if user is None:
        raise HTTPException(401, "not signed in")
    return user


def require_roles(*roles: str):
    def dep(user: AppUser = Depends(current_user)) -> AppUser:
        if user.role not in roles:
            raise HTTPException(403, "not allowed for your role")
        return user

    return dep


Staff = Depends(require_roles("admin", "supervisor", "agent"))
Manager = Depends(require_roles("admin", "supervisor"))
Admin = Depends(require_roles("admin"))
