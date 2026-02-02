# Project Nexus Backend (Vercel)

This is a tiny serverless backend that exposes:

- POST /api/generate-ideas

It accepts JSON like:
{
  "model": "gpt-4.1-mini",
  "prompt": "..."
}

It returns:
{
  "ideasText": "..."
}

## Environment variable (required)

Set this on Vercel:
- OPENAI_API_KEY

## Deploy

1) Push this folder to a GitHub repo (or its own folder in your repo)
2) Import the repo in Vercel
3) Add OPENAI_API_KEY in Vercel project settings (Environment Variables)
4) Deploy, then copy your Vercel URL and paste it into your frontend's BACKEND_BASE
