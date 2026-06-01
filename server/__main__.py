"""Allow ``python -m server`` — used by ``hms dev --reload`` child spawn."""
from server.cli import main

raise SystemExit(main())
