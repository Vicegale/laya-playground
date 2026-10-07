"""Classify a question with the local English Laya checkpoint.

    .venv/bin/python tools/classify_question.py "How do I fix this Python error?"
    .venv/bin/python tools/classify_question.py --offline < question.txt

Prints Laya's complete response as JSON. Model diagnostics go to stderr.
"""

import argparse
from contextlib import redirect_stdout
import json
import os
import sys


QUESTIONS = {
    "question_type": {
        "type": "choice",
        "instructions": "What type of question or request is this?",
        "criteria": {
            "technical": "programming, code, scripts, setup, debugging, or system errors",
            "product": "product features, capabilities, usability, or feature requests",
            "billing": "charges, invoices, payments, subscriptions, or refunds",
            "other": "topics unrelated to technical, product, or billing questions",
        },
    },
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("question", nargs="?", help="Text to classify; reads stdin if omitted")
    parser.add_argument("--offline", action="store_true", help="Use cached weights without network access")
    args = parser.parse_args()
    if args.question is None and sys.stdin.isatty():
        parser.error("provide a question argument or pipe text into stdin")
    text = args.question if args.question is not None else sys.stdin.read()
    if not text.strip():
        parser.error("question must not be empty")

    os.environ.setdefault("USE_TF", "0")
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    if args.offline:
        os.environ["HF_HUB_OFFLINE"] = "1"

    with redirect_stdout(sys.stderr):
        import laya

        agent = laya.load("convaiinnovations/laya")
        result = agent.predict({"question": text}, QUESTIONS)
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
