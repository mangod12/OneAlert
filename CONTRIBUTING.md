# Contributing to OneAlert

Thanks for your interest in contributing! OneAlert is an open-source AI Security OS for industrial OT/ICS networks.

## Quick Start

```bash
git clone https://github.com/mangod12/OneAlert.git
cd OneAlert
pip install -r requirements.txt
python -m uvicorn backend.main:app --reload
```

## Development Workflow

1. Fork the repo and create a feature branch
2. Write tests first (TDD encouraged)
3. Implement the feature
4. Run `pytest tests/` — all tests must pass
5. Run `python -m compileall backend/ -q` — no compile errors
6. Submit a PR with a clear description

## Code Standards

- **Python**: Follow existing patterns. Pydantic v2 schemas co-located with SQLAlchemy models.
- **TypeScript/React**: Functional components, Zustand for state, Tailwind for styling.
- **Tests**: pytest for backend, Playwright for E2E. Aim for 80%+ coverage on new code.
- **Commits**: `<type>: <description>` (feat, fix, refactor, docs, test, chore)

## Areas We Need Help

| Area | Difficulty | Impact |
|------|-----------|--------|
| New event parsers (CloudTrail, Windows) | Medium | High |
| MITRE technique coverage | Easy | High |
| Sigma rule import/export | Medium | High |
| Detection rule test harness | Hard | Very High |
| UI accessibility audit | Easy | Medium |
| OT protocol parsers (BACnet, HART-IP) | Hard | High |
| Performance benchmarks | Medium | Medium |

## Project Layout

See [docs/CODEMAP.md](docs/CODEMAP.md) for a complete file-by-file reference.

## Questions?

Open a GitHub issue or discussion. We're friendly.
