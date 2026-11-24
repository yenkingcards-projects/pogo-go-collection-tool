# 03: Read one screenshot

**What to build:** Upload an appraisal screenshot → CP, HP, IV bars, nickname, candy name, weight/height, XXS/XXL, lucky/shiny/shadow, date, location, buddy, background.

**Blocked by:** 01, 02. Waiting on Ben's screenshots.

**Status:** done

- [x] IV bars read from pixels
- [x] Text via Apple Vision helper
- [x] Species from candy name + CP/HP/IV math, never the nickname
- [x] Failed reads go to a "Failed scans" list
- [x] Tests against Ben's 20 fixture screenshots (25 in fixtures/expected.json)

**Notes:** shiny, shadow and special background are not detected yet (none in the fixtures; need example screenshots). Buddy/lucky are detected from on-screen text only.
