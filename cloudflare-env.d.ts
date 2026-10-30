declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    OPENAI_API_KEY?: string;
    OPENAI_MODEL?: string;
    OPENAI_TRANSCRIBE_MODEL?: string;
    OPENAI_REALTIME_MODEL?: string;
    OPENAI_CHILD_DATA_READY?: string;
    OPENAI_LIVE_MODEL?: string;
    OPENAI_LIVE_VOICE?: string;
    OPENAI_LIVE_BACKEND_MODEL?: string;
  }
}
