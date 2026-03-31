"""Agent 1 — Extractor: raw page → structured JSON."""
import json
from openai import AsyncOpenAI

SYSTEM = """\
You are a structured data extraction agent. Your job is to read a webpage and \
extract factual, structured information with zero hallucination. If a field \
cannot be determined from the text, use null. Return only valid JSON.\
"""

PROMPT = """\
Extract structured information from this webpage.

URL: {url}
Title: {title}
Page text (first 6000 chars):
{text}

Return a JSON object with exactly these fields:
{{
  "source_type": "news|academic|blog|official|social|documentation|other",
  "author": "string or null",
  "publish_date": "ISO date string or null",
  "organization": "publishing org or null",
  "main_topic": "one sentence describing the core topic",
  "primary_claims": ["list of 3-6 specific factual claims or assertions made"],
  "entities": {{
    "people": ["named individuals mentioned"],
    "organizations": ["orgs, companies, institutions"],
    "places": ["locations, countries, regions"],
    "dates": ["specific dates or time periods referenced"],
    "projects": ["projects, programs, initiatives named"]
  }},
  "cited_urls": ["external URLs referenced in the page text"],
  "action_verbs": ["key action words: launched, published, funded, etc."],
  "data_points": ["any quantitative facts: percentages, amounts, counts"],
  "credibility_signals": {{
    "has_citations": true/false,
    "has_author": true/false,
    "has_date": true/false,
    "domain_type": "gov|edu|org|com|other"
  }}
}}
"""


async def run(page_data: dict, api_key: str) -> dict:
    client = AsyncOpenAI(api_key=api_key)

    prompt = PROMPT.format(
        url=page_data.get("url", ""),
        title=page_data.get("title", ""),
        text=page_data.get("text", "")[:6000],
    )

    response = await client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": prompt},
        ],
        response_format={"type": "json_object"},
        temperature=0.1,
        max_tokens=1200,
    )

    result = json.loads(response.choices[0].message.content)
    result["_agent"] = "extractor"
    result["_url"] = page_data.get("url", "")
    result["_title"] = page_data.get("title", "")
    return result
