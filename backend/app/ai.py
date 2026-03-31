import json
from openai import AsyncOpenAI

_SUMMARY_PROMPT = """\
Analyze this webpage and produce a structured JSON summary for permanent archival.

URL: {url}
Title: {title}

Page text (first 8000 chars):
{text}

Return ONLY a JSON object with exactly these fields:
{{
  "summary": "2-3 paragraph prose summary of the page",
  "key_points": ["list of 5-10 most important facts or statements"],
  "headings": ["main section headings found on the page"],
  "entities": {{
    "people": ["named people mentioned"],
    "organizations": ["orgs / companies mentioned"],
    "places": ["locations mentioned"],
    "dates": ["significant dates or time references"]
  }},
  "topics": ["3-5 topic tags"],
  "importance": "one sentence on why this page is worth saving"
}}"""


async def extract_summary(
    html: str, text: str, url: str, title: str, api_key: str
) -> dict:
    client = AsyncOpenAI(api_key=api_key)
    prompt = _SUMMARY_PROMPT.format(url=url, title=title, text=text[:8000])

    response = await client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
        temperature=0.3,
        max_tokens=1500,
    )
    return json.loads(response.choices[0].message.content)


async def generate_embeddings(text: str, api_key: str) -> list[float]:
    client = AsyncOpenAI(api_key=api_key)
    response = await client.embeddings.create(
        model="text-embedding-3-small",
        input=text[:8000],
    )
    return response.data[0].embedding
