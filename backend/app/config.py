from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    openai_api_key: str = ""
    redis_url: str = "redis://localhost:6379/0"
    filecoin_private_key: str = ""
    filecoin_network: str = "calibration"
    encryption_secret: str = "change-me-in-production-32chars!"
    backend_api_key: str = ""
    # AT Protocol (Hypercerts) — create a free account at certified.app or bsky.social
    pds_url: str = "https://bsky.social"
    pds_handle: str = ""   # e.g. yourname.certified.app
    pds_password: str = "" # app password from Settings → App Passwords

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
