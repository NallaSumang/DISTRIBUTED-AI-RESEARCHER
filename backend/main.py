from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator
from collections import defaultdict
import uuid
import json
import os
import time
from dotenv import load_dotenv, find_dotenv
import redis

load_dotenv(find_dotenv(), override=True)

app = FastAPI(
    title="Distributed AI Research Agent API",
    docs_url=None,       # disable /docs (Swagger UI)
    redoc_url=None,      # disable /redoc
    openapi_url=None,    # disable /openapi.json — hides endpoint structure from scanners
)

# --- CORS: Only allow your actual frontend domain ---
ALLOWED_ORIGINS = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:3000,https://distributed-ai-researcher.vercel.app"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

# --- REDIS CONNECTION ---
redis_uri = os.getenv('UPSTASH_REDIS_URI')
if not redis_uri:
    raise RuntimeError("UPSTASH_REDIS_URI environment variable not set")
redis_client = redis.from_url(redis_uri)

# --- RATE LIMITING (Redis Backed): 5 research requests per minute per IP ---
RATE_LIMIT = 5
RATE_WINDOW = 60

@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    # Only rate-limit the research endpoint
    if request.url.path == "/api/research" and request.method == "POST":
        client_ip = request.client.host if request.client else "unknown"
        redis_key = f"rate_limit:{client_ip}"
        
        try:
            current = redis_client.incr(redis_key)
            if current == 1:
                redis_client.expire(redis_key, RATE_WINDOW)
                
            if current > RATE_LIMIT:
                raise HTTPException(status_code=429, detail="Too many requests. Please wait a minute.")
        except redis.RedisError as e:
            # If Redis fails, log it and let the request pass (fail open) rather than breaking the API
            print(f"Redis rate limit error: {e}")
            
    return await call_next(request)

# --- REQUEST MODEL WITH VALIDATION ---
class ResearchRequest(BaseModel):
    query: str

    @field_validator("query")
    @classmethod
    def validate_query(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Query cannot be empty.")
        if len(v) > 2000:
            raise ValueError("Query too long. Maximum 2000 characters.")
        return v

from fastapi.security import APIKeyHeader
from fastapi import Security, Depends

API_KEY_NAME = "x-api-key"
api_key_header = APIKeyHeader(name=API_KEY_NAME, auto_error=True)

def verify_api_key(api_key: str = Security(api_key_header)):
    expected_api_key = os.getenv("API_SECRET_KEY") or os.getenv("API_MANUAL_SECRET_KEY")
    if not expected_api_key:
        # In production, if this isn't set, reject everything.
        raise HTTPException(status_code=500, detail="API_SECRET_KEY not configured on server")
    if api_key != expected_api_key:
        raise HTTPException(status_code=401, detail="Invalid API Key")
    return api_key

@app.get("/")
async def root():
    return {"status": "Online", "service": "Distributed AI Research Agent"}

@app.post("/api/research")
async def start_research(request: ResearchRequest, api_key: str = Depends(verify_api_key)):
    job_id = str(uuid.uuid4())
    job_data = {"job_id": job_id, "query": request.query}

    # Send to queue
    redis_client.lpush("research_jobs", json.dumps(job_data))

    return {"job_id": job_id, "status": "queued"}

@app.get("/api/research/{job_id}")
async def get_result(job_id: str, api_key: str = Depends(verify_api_key)):
    # Check if the worker saved a result for this ID
    result = redis_client.get(f"result:{job_id}")

    if result:
        result_data = result.decode('utf-8')
        # Check if it's a failure marker
        if result_data.startswith("__FAILED__:"):
            return {
                "job_id": job_id,
                "status": "failed",
                "data": result_data.replace("__FAILED__:", "")
            }
        return {
            "job_id": job_id,
            "status": "completed",
            "data": result_data
        }

    return {"job_id": job_id, "status": "processing"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=7860)