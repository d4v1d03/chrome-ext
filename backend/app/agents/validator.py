"""Agent 2 — Validator: credibility + consistency check using RAG context."""
import json
from openai import AsyncOpenAI

SYSTEM = """\
You are a critical fact-checking and credibility assessment agent. \
You evaluate whether claims from a webpage are credible, internally \
consistent, and how they relate to existing knowledge. Be rigorous \
but fair. Return only valid JSON.\
"""

PROMPT = """\
Validate this extracted webpage data for credibility and consistency.

## Extracted Data
{extracted}

## Related Pages from User's Archive (for cross-referencing)
{related_context}

Evaluate and return a JSON object with exactly these fields:
{{
  "credibility_score": 0-100,
  "consistency_score": 0-100,
  "credibility_assessment": "brief 1-2 sentence assessment",
  "credibility_flags": [
    "list of specific concerns or red flags (empty list if none)"
  ],
  "supporting_evidence": [
    "claims that are corroborated by related pages in archive"
  ],
  "contradictions": [
    "any claims that contradict related pages in archive"
  ],
  "source_reputation": "high|medium|low|unknown",
  "content_type": "factual|opinion|promotional|mixed|unknown",
  "verification_suggestions": [
    "1-3 ways a human could verify the key claims"
  ]
}}

Credibility score guide:
- 80-100: Major publisher, gov/edu source, well-cited academic work
- 60-79: Established org, has author+date+citations, consistent claims
- 40-59: Blog/opinion, partial sourcing, some unverified claims
- 20-39: Promotional, anonymous, lacks sourcing
- 0-19: Misleading signals, contradicts known facts, suspicious
"""


async def run(extracted: dict, related_pages: list[dict], api_key: str) -> dict:
    client = AsyncOpenAI(api_key=api_key)

    if related_pages:
        ctx_lines = []
        for i, p in enumerate(related_pages[:3], 1):
            ctx_lines.append(
                f"{i}. [{p.get('title', 'Untitled')}] ({p.get('url', '')})\n"
                f"   Topics: {p.get('topics', '')}\n"
                f"   Summary: {p.get('summary_snippet', '')}"
            )
        related_context = "\n".join(ctx_lines)
    else:
        related_context = "No related pages found in archive yet."

    prompt = PROMPT.format(
        extracted=json.dumps(extracted, indent=2)[:3000],
        related_context=related_context,
    )

    response = await client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": prompt},
        ],
        response_format={"type": "json_object"},
        temperature=0.2,
        max_tokens=800,
    )

    result = json.loads(response.choices[0].message.content)
    result["_agent"] = "validator"
    result["_related_count"] = len(related_pages)
    return result
