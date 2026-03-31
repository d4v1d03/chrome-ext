"""Agent 4 — Generator: synthesises all agent outputs into the final archive record + Hypercert payload."""
import json
from openai import AsyncOpenAI

SYSTEM = """\
You are a knowledge synthesis agent. You combine structured extraction, \
validation, and scoring outputs into a final archive record and a \
Hypercert impact claim. Be precise and schema-compliant. \
Return only valid JSON.\
"""

PROMPT = """\
Synthesise these agent outputs into a final archive record.

## Extracted Data
{extracted}

## Validation
{validated}

## Impact Scoring
{scored}

## Evidence CIDs (Filecoin storage references)
{cids}

Generate the final record. Return a JSON object with exactly these fields:
{{
  "summary": "3-4 paragraph human-readable summary of what was saved and why it matters",
  "key_points": ["5-8 most important takeaways"],
  "topics": ["3-5 topic tags"],
  "importance": "one sentence on archival importance",
  "search_snippet": "2-3 sentence description optimised for semantic retrieval",
  "hypercert_payload": {{
    "work": {{
      "title": "concise title of the work/action documented",
      "description": "what work was done",
      "contributors": ["actor names from extracted data"],
      "scope": {{
        "description": "geographic or thematic scope",
        "areas": ["list of scope areas"]
      }},
      "timeframe": {{
        "start": "ISO date or year or null",
        "end": "ISO date or year or null"
      }}
    }},
    "impact": {{
      "description": "what impact was or will be achieved",
      "contributors": ["who benefits or is impacted"],
      "scope": {{
        "description": "impact scope description",
        "areas": ["impact areas"]
      }},
      "timeframe": {{
        "start": "ISO date or null",
        "end": "ISO date or null"
      }}
    }},
    "rights": {{
      "description": "CC0 — open data",
      "uri": "https://creativecommons.org/publicdomain/zero/1.0/"
    }},
    "metadata": {{
      "name": "hypercert name (max 60 chars)",
      "description": "hypercert description (max 200 chars)",
      "image": null,
      "external_url": "{url}",
      "impact_type": "{impact_type}",
      "impact_score": {impact_score},
      "confidence_score": {confidence_score},
      "evidence": {cids_json},
      "properties": {{
        "source_type": "{source_type}",
        "credibility_score": {credibility_score},
        "novelty_score": {novelty_score}
      }}
    }}
  }}
}}
"""


async def run(
    extracted: dict,
    validated: dict,
    scored: dict,
    evidence_cids: list[str],
    api_key: str,
) -> dict:
    client = AsyncOpenAI(api_key=api_key)

    prompt = PROMPT.format(
        extracted=json.dumps(extracted, indent=2)[:2000],
        validated=json.dumps(validated, indent=2)[:1000],
        scored=json.dumps(scored, indent=2)[:1000],
        cids=", ".join(evidence_cids) if evidence_cids else "none",
        url=extracted.get("_url", ""),
        impact_type=scored.get("impact_type", "other"),
        impact_score=scored.get("impact_score", 0),
        confidence_score=scored.get("confidence_score", 0),
        source_type=extracted.get("source_type", "other"),
        credibility_score=validated.get("credibility_score", 0),
        novelty_score=scored.get("novelty_score", 0),
        cids_json=json.dumps(
            [{"type": "filecoin", "cid": c} for c in evidence_cids]
        ),
    )

    response = await client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": prompt},
        ],
        response_format={"type": "json_object"},
        temperature=0.3,
        max_tokens=2000,
    )

    result = json.loads(response.choices[0].message.content)
    result["_agent"] = "generator"
    return result
