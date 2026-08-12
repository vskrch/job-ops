"""Browser Use agentic automation sidecar.

Thin FastAPI wrapper around the `browser-use` Python library so the
TypeScript orchestrator can drive interactive browser tasks (auth-gated
scraping, interactive extraction) over HTTP.

Design notes (ADR-004 Track B1):
- Read-only scraping only; no form submission (that is Stage B2).
- Accepts and forwards `x-request-id` for distributed tracing.
- Requires `BROWSER_USE_API_TOKEN` (shared secret) on all endpoints.
- Never persists credentials; sessions are per-request.
"""

import asyncio
import logging
import os
import uuid

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

logging.basicConfig(
    level=os.environ.get("BROWSER_USE_LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("browser-use-wrapper")

app = FastAPI(title="Browser Use Sidecar", version="1.0.0")
security = HTTPBearer(auto_error=False)

EXPECTED_TOKEN = os.environ.get("BROWSER_USE_API_TOKEN", "")

# Bounded concurrency: one task at a time by default.
SEMAPHORE_LIMIT = int(os.environ.get("BROWSER_USE_MAX_CONCURRENCY", "1"))
_semaphore = asyncio.Semaphore(SEMAPHORE_LIMIT)


class RunTaskRequest(BaseModel):
    task: str = Field(..., min_length=1, max_length=8000)
    url: str | None = None
    maxSteps: int | None = Field(default=None, ge=1, le=50)
    schema: dict | None = None


class RunTaskResponse(BaseModel):
    success: bool
    result: dict | None = None
    screenshots: list[str] = []
    steps: int = 0
    error: str | None = None


def require_auth(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    x_browser_use_token: str | None = Header(default=None, alias="X-Browser-Use-Token"),
) -> None:
    if not EXPECTED_TOKEN:
        raise HTTPException(status_code=503, detail="Browser Use token not configured")
    supplied = credentials.credentials if credentials else (x_browser_use_token or "")
    if supplied != EXPECTED_TOKEN:
        raise HTTPException(status_code=401, detail="Unauthorized")


def _request_id(request: Request) -> str:
    return request.headers.get("x-request-id", "unknown")


@app.get("/health")
def health():
    return {"status": "ok", "version": "1.0.0"}


@app.get("/sessions")
def sessions():
    return {"sessions": []}


@app.delete("/sessions/{session_id}")
def close_session(session_id: str):
    logger.info("Session close requested", extra={"session_id": session_id})
    return {"closed": True, "session_id": session_id}


@app.post("/run", response_model=RunTaskResponse)
async def run_task(
    body: RunTaskRequest,
    request: Request,
    _: None = Depends(require_auth),
):
    request_id = _request_id(request)
    logger.info(
        "Browser task started",
        extra={
            "request_id": request_id,
            "task": body.task[:120],
            "url": body.url,
            "max_steps": body.maxSteps,
        },
    )

    async with _semaphore:
        try:
            from browser_use import Agent
            from langchain_openai import ChatOpenAI

            llm_api_key = os.environ.get("BROWSER_USE_LLM_API_KEY") or os.environ.get(
                "LLM_API_KEY"
            )
            llm_base_url = os.environ.get(
                "BROWSER_USE_LLM_BASE_URL", "https://api.openai.com/v1"
            )
            llm_model = os.environ.get("BROWSER_USE_LLM_MODEL", "gpt-4o-mini")
            if not llm_api_key:
                raise HTTPException(
                    status_code=503, detail="LLM API key not configured for Browser Use"
                )

            llm = ChatOpenAI(
                api_key=llm_api_key,
                base_url=llm_base_url,
                model=llm_model,
                temperature=0,
            )
            max_steps = body.maxSteps or int(os.environ.get("BROWSER_USE_MAX_STEPS", "10"))

            task_text = body.task
            if body.url:
                task_text = f"Go to {body.url}. {task_text}"

            agent = Agent(task=task_text, llm=llm, max_steps=max_steps)
            result = await agent.run()

            steps = int(getattr(result, "total_steps", 0) or 0)
            final_result = None
            if hasattr(result, "final_result") and result.final_result:
                final_result = {"text": str(result.final_result)}
            elif hasattr(result, "history"):
                final_result = {"history_len": len(result.history)}

            logger.info(
                "Browser task completed",
                extra={"request_id": request_id, "steps": steps},
            )
            return RunTaskResponse(
                success=True, result=final_result, screenshots=[], steps=steps
            )
        except HTTPException:
            raise
        except Exception as exc:  # noqa: BLE001 — return structured error to caller
            logger.error(
                "Browser task failed",
                extra={"request_id": request_id, "error": str(exc)[:500]},
            )
            return RunTaskResponse(success=False, error=str(exc)[:1000])


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
