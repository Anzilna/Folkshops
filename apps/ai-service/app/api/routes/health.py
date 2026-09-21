from fastapi import APIRouter, Request

router = APIRouter(tags=["health"])


@router.get("/health")
async def health(request: Request) -> dict:
    db = request.app.state.db
    cache = request.app.state.cache
    vector_store = request.app.state.vector_store

    db_ok = await db.health_check()
    cache_ok = await cache.health_check()
    vector_ok = await vector_store.health_check()

    status = "ok" if (db_ok and cache_ok and vector_ok) else "degraded"
    return {
        "status": status,
        "dependencies": {"postgres": db_ok, "redis": cache_ok, "vector_store": vector_ok},
    }
