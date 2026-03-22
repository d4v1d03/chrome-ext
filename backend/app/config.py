from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    openai_api_key: str = ""
    redis_url: str = "redis://localhost:6379/0"
    filecoin_private_key: str = ""
    filecoin_network: str = "calibration"
    # Must be at least 16 chars; change in production
    encryption_secret: str = "change-me-in-production-32chars!"
    # Optional bearer token to protect the API
    backend_api_key: str = ""

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
