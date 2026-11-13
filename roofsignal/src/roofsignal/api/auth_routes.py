from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from roofsignal.api.deps import current_user, get_session, require_service
from roofsignal.core import auth
from roofsignal.db.models import AppUser

router = APIRouter(prefix="/auth")


class LoginIn(BaseModel):
    email: str
    password: str


def _user(u: AppUser) -> dict:
    return {"id": str(u.id), "email": u.email, "display_name": u.display_name, "role": u.role}


@router.post("/login", dependencies=[Depends(require_service)])
def login(body: LoginIn, x_client_ip: str | None = Header(default=None),
          session: Session = Depends(get_session)) -> dict:
    result = auth.login(session, body.email, body.password, ip=x_client_ip)
    if result is None:
        raise HTTPException(401, "Email or password is incorrect.")
    user, token = result
    return {"token": token, "user": _user(user)}


@router.post("/logout")
def logout(authorization: str | None = Header(default=None), _: AppUser = Depends(current_user),
           session: Session = Depends(get_session)) -> dict:
    auth.logout(session, (authorization or "").removeprefix("Bearer ").strip())
    return {"ok": True}


@router.get("/me")
def me(user: AppUser = Depends(current_user)) -> dict:
    return _user(user)
