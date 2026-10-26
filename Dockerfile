# The services' image: the live service, the listener and the feeder are the same code with a different command
# (infra/resources.bicep). Python and the Azure SDKs, ffmpeg for the listener's audio, and the trained models and the
# season the pipeline reads. Torch comes from PyTorch's CPU index on Linux (pyproject.toml).
FROM python:3.12-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.9.5 /uv /usr/local/bin/uv

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PROJECT_ENVIRONMENT=/app/.venv PYTHONUNBUFFERED=1
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --extra azure --no-install-project

COPY tempo ./tempo
COPY models ./models
COPY assets/audio/commentator.wav ./assets/audio/commentator.wav
RUN uv sync --frozen --no-dev --extra azure

# the live service answers /healthz, /cues and /negotiate here
ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["uv", "run", "--no-sync", "tempo"]
CMD ["live", "m_demo"]
