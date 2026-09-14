# ERCOT as a third filing source — scoping, 2026-09-06

**The headline finding: ERCOT publishes no named, project-level large-load
list.** NPRR1267 (Nodal Protocols 3.2.7) mandates aggregation with >=3
customers per bucket for customer confidentiality — so there is no ERCOT
equivalent of the NYISO load queue or PJM TEAC filings to import. The official
sources split into a project-level *generator* file (with POIs) and aggregate
*load* reports (without names).

## Datasets found

### ERCOT Large Load Interconnection Status Report (NPRR1267 monthly deck)
- URL: https://www.ercot.com/files/docs/2026/03/12/March-TAC-Report.pdf
- Format: PDF slide deck (no fixed URL; posted under ercot.com/files/docs/... as a TAC meeting item each month, e.g. February-TAC-Report.pdf, March-TAC-Report.pdf; also summarized in the ERCOT Monthly newsletter and Monthly Operational Overview PDFs)
- Cadence: Monthly (mandated by Nodal Protocols Sec. 3.2.7, created by NPRR1267, PUCT-approved 2025-07-31)
- Relevance: This IS the official ERCOT large-load (data centre/crypto) filing product — the ERCOT-side analogue of a queue report — but it is deliberately anonymized. Use it for registry-level totals, status mix, zone/TSP distribution and month-over-month deltas (e.g. 9,042 MW approved to energize, ~233 GW queue at end-2025), not for individual site records. Verified March 2026 edition text-extracted; NPRR1267 protocol language confirmed from https://www.ercot.com/files/docs/2025/01/08/1267NPRR-01%20Large%20Load%20Interconnection%20Status%20Report%20010825.docx and https://www.ercot.com/mktrules/issues/NPRR1267
- Fields: AGGREGATE ONLY, no project names/POIs by design: queue MW by status (Observed Energized / Approved to Energize but Not Operational / Planning Studies Approved / Under ERCOT Review / No Studies Submitted), by load zone-weather zone, by project type (data center vs crypto vs other), by TSP, by size bucket, by submittal date and requested in-service year; observed non-simultaneous and simultaneous peak MW of energized large loads. Protocol requires >=3 customers per published bucket and permits rounding, so ERCOT will never name a load here. Definition: Large Load = >=75 MW aggregate peak demand behind common POI(s).

### ERCOT GIS Report — Generator Interconnection Status (EMIL PG7-200-ER)
- URL: https://www.ercot.com/misapp/servlets/IceDocListJsonWS?reportTypeId=15933
- Format: XLSX (served with .zip-ish content; latest Aug 2026 file = https://www.ercot.com/misdownload/servlets/mirDownload?doclookupId=1269363208). Discovery: the IceDocListJsonWS JSON lists ~170 docs with FriendlyName + DocID + PublishDate; download via https://www.ercot.com/misdownload/servlets/mirDownload?doclookupId={DocID}. No auth needed on these endpoints (the legacy mis.ercot.com host rejects plain curl TLS; use www.ercot.com paths). Also available via the ERCOT Public API (api.ercot.com, free registration + subscription key). Product page: https://www.ercot.com/mp/data-products/data-product-details?id=PG7-200-ER
- Cadence: Monthly (~1st business day; history back to Feb 2017). Note the same report type also carries a monthly 'Co-located_Battery_Identification_Report' file — filter FriendlyName startswith 'GIS_Report'
- Relevance: The only machine-readable, project-level ERCOT interconnection file with substation/POI + county + MW — but it covers GENERATION, not loads. For a data-centre registry it matters two ways: (a) co-located/behind-the-meter data-centre and crypto campuses appear via their paired generation projects and net-metering arrangements; (b) it is the substation/POI gazetteer for geolocating the aggregate large-load data. gridstatus already parses it (gridstatus/ercot.py, GIS_REPORT_RTID=15933), which validates the schema above.
- Fields: Sheets: Contents, Disclaimer and References, Summary, 'Project Details - Large Gen' (~1,778 rows), 'Project Details - Small Gen', GIM Trends, Commissioning Update, Inactive Projects, Cancellation Update. Large Gen columns (header row found by scanning for 'INR'): INR (queue ID), Project Name, GIM Study Phase, Interconnecting Entity, POI Location (named substation/line + kV, e.g. '59903 Bearkat 345kV'), County, CDR Reporting Zone, Projected COD, Fuel, Technology, Capacity (MW), Screening/FIS study milestones, IA Signed, Air/GHG permits, Construction Start/End, Approved for Energization, Approved for Synchronization, Comment.

### LFLTF (Large Flexible Load Task Force, 2022-2024, now inactive) and successor LLWG (Large Load Working Group) meeting materials
- URL: https://www.ercot.com/committees/inactive/lfltf
- Format: Per-meeting PDF/PPTX decks (e.g. 'LLI Queue Status Update - 2024-4-1.pdf' at https://www.ercot.com/files/docs/2024/03/26/LLI%20Queue%20Status%20Update%20-%202024-4-1.pdf; LLWG page: https://www.ercot.com/committees/tac/llwg — materials hang off ERCOT calendar event pages, loaded dynamically)
- Cadence: Historical LFLTF: roughly monthly 2022-2024 (yearly archive pages /committees/inactive/lfltf/2022, /2023, /2024). LLWG: ~monthly meetings through 2026; the monthly LLI status deck is presented at TAC
- Relevance: Back-history of the large-load queue before the NPRR1267 report existed — lets the registry build a 2022-2026 time series of ERCOT LFL queue totals — plus the interpretive context (definitions, status categories) an importer needs. Not a primary ingest target; scrape opportunistically.
- Fields: Aggregate queue snapshots (MW by status/zone/TSP/type/size, sometimes county-level maps), LFL definition work (75 MW threshold; crypto-mining focus), methodology notes, NPRR1191/1234/1267 and PGRR145 process discussion. No project names.

### Batch Zero (PGRR145) large-load study process documents
- URL: https://www.ercot.com/services/rq/large-load-integration
- Format: XLSX forms + PDF/PPTX (Batch Zero Load Information Form https://www.ercot.com/files/docs/2026/06/18/Batch-Zero-Load-Information-Form-06172026.xlsx; timeline PPTX; FAQ XLSX)
- Cadence: One-off/process-driven. 326 projects / ~205 GW entered Batch Zero (mid-2026); the Batch Zero Interconnection Study report with per-project classifications and MW allocations was due April 9, 2027 but is PAUSED since the Governor's Aug 3, 2026 verification directive for data-centre/crypto loads; no public project list yet
- Relevance: Watch item, not an ingest target today: when the Batch Zero study report publishes (2027), it may be the first ERCOT document with per-project large-load classifications. Also the definitive documentation of the new >=75 MW interconnection process.
- Fields: The Load Information Form shows what ERCOT collects per large load (site, POI/substation, TSP/DSP, MW, in-service date, load type, flexibility/curtailability, standalone vs co-located) — useful as a target schema — but submitted forms are confidential

### ercotqueue.com large-load tracker (third-party, unofficial)
- URL: https://www.ercotqueue.com/large-loads
- Format: JSON files under ercotqueue.com/data/load/ (load projects, load studies, source documents, source registry, change feed, queue summary)
- Cadence: Staggered/irregular (queue metrics and source refreshes weeks-to-months apart)
- Relevance: The only project-level named large-load dataset found — because it is a third-party compilation of public filings (TSP/PUCT/press), not an ERCOT product. Useful for cross-checking registry entries; do not treat as authoritative and check its own terms before redistribution.
- Fields: Project-level large-load records compiled from public filings: name, status, MW, reported date, geographic precision flag, source document links

## Recommendation (verbatim from the scoping agent)

Ingest first: (1) the monthly GIS Report XLSX (EMIL PG7-200-ER) and (2) the monthly Large Load Interconnection Status Update PDF. Key framing for the registry: unlike PJM TEAC and the NYISO queue, ERCOT publishes NO named, project-level large-load list — NPRR1267 (Nodal Protocols 3.2.7) mandates aggregation with >=3 customers per bucket to protect customer confidentiality — so the ERCOT source splits into a project-level generation file (with POIs) and an aggregate load file (without names). Importer 1 (GIS Report, do this one first — it is fully mechanical): poll https://www.ercot.com/misapp/servlets/IceDocListJsonWS?reportTypeId=15933, pick the newest doc whose FriendlyName starts with "GIS_Report" (skip the Co-located_Battery files sharing the report type), download https://www.ercot.com/misdownload/servlets/mirDownload?doclookupId={DocID}, open as XLSX, and parse sheets "Project Details - Large Gen", "Project Details - Small Gen", "Inactive Projects", "Cancellation Update", locating each header row by scanning for the literal "INR" (gridstatus's ercot.py is a working reference implementation). Map: INR -> queue_id, Project Name -> asset name, Interconnecting Entity -> developer, POI Location -> substation/POI string (e.g. "59903 Bearkat 345kV"), County -> county, Capacity (MW) -> MW, Projected COD -> in-service, IA Signed / Approved for Energization / Approved for Synchronization -> status. In the registry this feeds co-located data-centre/crypto campus detection and gives a substation gazetteer for Texas. Importer 2 (LLI Status Update PDF): monthly aggregate-only PDF (status buckets: Observed Energized, Approved to Energize but Not Operational, Planning Studies Approved, Under ERCOT Review, No Studies Submitted; splits by load zone, TSP, load type incl. data centre vs crypto, size bucket, submittal and in-service year) — parse a dozen headline numbers per month (text-extractable with pypdf) into a time series; URLs are irregular (e.g. /files/docs/2026/03/12/March-TAC-Report.pdf), so discover via the TAC meeting entries on the ERCOT calendar or a monthly search, and expect a manual fallback. Licensing is favorable: ERCOT's Terms of Use (https://www.ercot.com/help/terms) allow public content to be used, reproduced and redistributed, and expressly allow raw data to be redistributed in compilations/analyses without preserving notices; everything is AS-IS with no warranty, and the GIS Report carries a "FOR PLANNING PURPOSES ONLY" disclaimer worth surfacing in the registry's source metadata. Flag for later: the Batch Zero study report (due ~April 2027, currently paused by the Governor's verification directive) may become ERCOT's first per-project large-load publication, and Texas SB6/PUCT large-load filings are the likelier venue for named sites in the meantime.

## Registry decision

Deferred. The original wish was ERCOT as a third source of *named data-centre*
filings, and the official record cannot provide one by design. The mechanical
GIS (generator) importer is worth building when the plants side wants ERCOT
queue coverage; the third-party ercotqueue.com JSON is unofficial and its
licensing is unchecked - do not ingest it without reading its terms.
