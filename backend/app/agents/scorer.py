"""Agent 3 — Scorer: impact, confidence, novelty scoring."""
import json
from openai import AsyncOpenAI

SYSTEM = """\
You are an impact assessment agent. You evaluate the potential real-world \
impact of information or actions documented in a webpage, and score them \
on multiple dimensions. Be analytical and calibrated. Return only valid JSON.\
"""

PROMPT = """\
Score the impact of this content based on the extracted and validated data.

## Extracted Content
{extracted}

## Validation Results
Credibility score: {credibility_score}/100
Source reputation: {source_reputation}
Content type: {content_type}
Credibility flags: {flags}

## Archive Context
Novelty context (how different is this from the user's archive?):
{novelty_context}

Score and classify the content. Return a JSON object with exactly these fields:
{{
  "impact_score": 0-100,
  "confidence_score": 0-100,
  "novelty_score": 0-100,
  "impact_type": "research|policy|environmental|social|technological|economic|health|education|governance|other",
  "impact_magnitude": "global|national|regional|local|individual|unknown",
  "impact_timeframe": "immediate|short_term|long_term|ongoing|historical",
  "key_actors": ["who is doing/did the impactful thing"],
  "key_actions": ["what specific actions are being taken/taken"],
  "beneficiaries": ["who benefits from this impact"],
  "impact_summary": "2-3 sentences describing the impact in plain language",
  "score_rationale": "1-2 sentences explaining the impact_score"
}}

Scoring guide:
- impact_score: overall importance and reach of the content's subject matter
- confidence_score: how confident are we the claims are accurate (uses credibility)
- novelty_score: 100 = completely new topic in archive, 0 = exact duplicate
"""


async def run(
    extracted: dict,
    validated: dict,
    related_pages: list[dict],
    api_key: str,
) -> dict:
    client = AsyncOpenAI(api_key=api_key)

    if related_pages:
        novelty_lines = [
            f"- {p.get('title', 'Untitled')}: similarity={p.get('score', 0):.2f}"
            for p in related_pages[:3]
        ]
        novelty_context = (
            f"Top {len(related_pages)} most similar pages in archive:\n"
            + "\n".join(novelty_lines)
        )
    else:
        novelty_context = "Archive is empty — this is the first save. Novelty is maximal."

    prompt = PROMPT.format(
        extracted=json.dumps(extracted, indent=2)[:2500],
        credibility_score=validated.get("credibility_score", 0),
        source_reputation=validated.get("source_reputation", "unknown"),
        content_type=validated.get("content_type", "unknown"),
        flags=validated.get("credibility_flags", []),
        novelty_context=novelty_context,
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
    result["_agent"] = "scorer"
    return result
