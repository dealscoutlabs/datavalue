FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_PROJECT_ENVIRONMENT=/opt/venv PATH=/opt/venv/bin:$PATH
RUN pip install --no-cache-dir uv
WORKDIR /app
COPY pyproject.toml uv.lock* ./
RUN uv sync --no-dev --no-install-project
COPY src ./src
COPY config ./config
COPY migrations ./migrations
COPY alembic.ini ./
RUN uv sync --no-dev
EXPOSE 8000
CMD ["sh", "-c", "uvicorn roofsignal.api.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
