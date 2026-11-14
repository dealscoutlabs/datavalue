"""FastAPI app assembly.

Auth model:
  * every request needs X-Service-Token (it must come from our Next.js server, which holds the secret);
  * /api/* additionally needs a staff session (Authorization: Bearer <session token>) with the right role;
  * /public/* serves the homeowner landing page and opt-out (service token only, no staff session).
"""

from __future__ import annotations

from fastapi import Depends, FastAPI
from sqlalchemy import text
from sqlalchemy.orm import Session

from roofsignal.api import admin, agent, auth_routes, public
from roofsignal.api.deps import get_session

app = FastAPI(title="RoofSignal API", version="0.2.0")
app.include_router(auth_routes.router)
app.include_router(admin.router)
app.include_router(agent.router)
app.include_router(public.router)


@app.get("/health")
def health(session: Session = Depends(get_session)) -> dict:
    session.execute(text("SELECT 1"))
    return {"ok": True}
