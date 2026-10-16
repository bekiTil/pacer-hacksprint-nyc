"""Owner: Yared (Engine). Arize → scorecard bridge.

Pacer's learning lives in Arize: every Daytona test is traced as a `pacer.sandbox.test` span with the model
tier, the task/step kind and whether the tests passed; every model call is a `pacer.step.*` span with its
cost. This script exports those spans from Arize AX and prints ScorecardEntry[] JSON on stdout:
pass rate and average step cost per (kind, tier). core/scorecard.ts calls it.

Usage: .venv/bin/python scripts/arize_scorecard.py [--days 7]
"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(ROOT, ".env.local"))
load_dotenv(os.path.join(ROOT, ".env"))

import logging  # noqa: E402

logging.disable(logging.INFO)
os.environ.setdefault("TQDM_DISABLE", "1")

from arize import ArizeClient  # noqa: E402


def main() -> None:
    days = int(sys.argv[sys.argv.index("--days") + 1]) if "--days" in sys.argv else 7
    client = ArizeClient(api_key=os.environ["ARIZE_API_KEY"])
    end = datetime.now(timezone.utc)
    df = client.spans.export_to_df(
        space_id=os.environ["ARIZE_SPACE_ID"],
        project_name=os.environ.get("ARIZE_PROJECT_NAME") or "pacer",
        start_time=end - timedelta(days=days),
        end_time=end,
    )

    def col(name):
        return df[name] if name in df.columns else None

    if df.empty or col("attributes.model.tier") is None:
        print("[]")
        return
    kind = df["attributes.task.type"]
    if col("attributes.pacer.subtask.kind") is not None:
        kind = df["attributes.pacer.subtask.kind"].fillna(kind)
    df = df.assign(kind=kind, tier=df["attributes.model.tier"])

    tests = df[(df["name"] == "pacer.sandbox.test") & df["kind"].notna() & df["tier"].notna()]
    steps = df[df["name"].isin(["pacer.step.implement", "pacer.step.fix"]) & df["kind"].notna() & df["tier"].notna()]
    cost = (
        steps.groupby(["kind", "tier"])["attributes.cost.usd"].mean().to_dict()
        if "attributes.cost.usd" in steps.columns
        else {}
    )

    out = []
    for (k, t), g in tests.groupby(["kind", "tier"]):
        passed = g["attributes.tests.passed"].astype(str).str.lower().isin(["true", "1"])
        out.append(
            {
                "taskType": k,
                "tier": t,
                "runs": int(len(g)),
                "passRate": float(passed.mean()),
                "avgCostUsd": float(cost.get((k, t), 0) or 0),
            }
        )
    print(json.dumps(out))


if __name__ == "__main__":
    main()
