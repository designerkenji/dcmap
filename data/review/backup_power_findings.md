# Backup power and secondary feeds — research findings, for review

Status: research-grade, cited, unvouched. The structured version with every
URL and every skeptic verdict is `backup_power_findings.json` beside this file.
Skeptics upheld 21/21 checked claims; their corrections are quoted where they
matter.

**Vouched 2026-09-07** (by the user) and applied to the edges through
`data/dependency_overrides.csv` — the five Massena-area findings at medium+
confidence: SLI 2 dual circuits (secondary_feed=sub-moses, the shared-substation
case), Sabey MRG-1/2 (secondary_feed=sub-reynolds), ZeroC #1719 single POI
(secondary_feed=none), North Country DC's 115 diesel gensets (backup_power=yes)
and its single Reynolds POI (secondary_feed=none).

**Vouched 2026-09-07** (by the user), the Kintigh cluster - all six findings,
all skeptic-upheld: WNY STAMP's 12 diesel gensets (backup_power=yes, SEQR of
record) and single POI (secondary_feed=none - which contradicts this ledger's
derived secondary edge to sub-niagara, minted by splitting the circuit name
"Kintigh/Niagara - New Rochester 345kV" on its slash; the note on the override
records it); Somerset Load and Lake Mariner Data II each battery-backed with
explicitly no diesel on site (backup_power=yes, kind in the notes, duration
unestablished) and each on dual 345 kV circuits into the single Kintigh
substation (secondary_feed=sub-kintigh, the shared-substation answer).

**Vouched 2026-09-07** (by the user), the remaining upheld medium+ findings:
Arsenal #1730 and ZeroC #1731 (each a tap on ONE Haverstock-Adirondack circuit,
secondary_feed=none on both ends of each); Micron Clay (backup_power=yes - 118
planned diesel gensets per DEC permit record - and secondary_feed=none, eight
laterals all from the one Clay substation, on both queue phases); Ranalli
SuperDC (secondary_feed=none, Clay-Pannell tap); NY-Route 9W #1757
(secondary_feed=none - and the skeptic's larger fact: the row is status 0,
WITHDRAWN); Riverview D&T Campus (backup_power=no - the developer's own
no-generators claim, pre-approval, on both edges); Globe DH 1 and 2
(backup_power=partial - BESS and up-to-40-MW CCHP against 200 MW loads,
single vendor source, site mapping inferred from queue order).

The findings below this line that remain unvouched are the low-confidence
ones - all valued unknown, which the edges already say.

## St. Lawrence Infrastructure 2 cluster
- **St. Lawrence Infrastructure 2 (St. Lawrence Infrastructure LLC, 1,935 MW)** · `secondary_feed` = yes — dual named circuits, but no second substation: POI is NYPA's 230kV Moses Massena 1 (MMS-1) AND 230kV Moses Massena 2 (MMS-2) (high confidence)
  NYISO's official interconnection queue (Load Projects sheet, queue #1743) lists the Points of Interconnection verbatim as "NYPA's 230kV Moses Massena 1 (MMS-1) and 230kV Moses Massena 2 (MMS-2)" — two separately named 230 kV circuits, so a documented second transmission feed exists at the POI level. However, both circuits emanate from the same NYPA Robert Moses switchyard (they are the Moses–Masse…
  - https://www.nyiso.com/documents/20142/1407078/NYISO-Interconnection-Queue.xlsx
  - https://www.nyiso.com/interconnections
- **SDC St. Lawrence (Sabey Data Center Properties, LLC, 120 MW)** · `secondary_feed` = yes — dual named circuits, but no second substation: POI is Moses-Reynolds MRG-1 AND Moses-Reynolds MRG-2 at 115kV (high confidence)
  NYISO's official interconnection queue (Load Projects sheet, queue #1315) lists the Points of Interconnection verbatim as "Moses-Reynolds MRG-1 and Moses-Reynolds MRG-2 at 115kV" — two separately named 115 kV circuits between the Moses switchyard and the Reynolds substation, i.e., a documented second feed at the POI level, but both circuits source from the same Robert Moses switchyard; no alternat…
  - https://www.nyiso.com/documents/20142/1407078/NYISO-Interconnection-Queue.xlsx
  - https://www.stlawco.gov/sites/default/files/Planning/Trainings/LGC%202025%20Planning%20&%20Zoning%20Presentation%20-%20Final.pdf
  - https://www.interconnection.fyi/project/nyiso-1315

  *Cluster note:* Common-mode risk: both loads interconnect via paired circuits that all emanate from NYPA's Robert Moses switchyard in Massena (SLI 2 on the Moses–Massena 230 kV pair MMS-1/MMS-2; Sabey on the Moses–Reynolds 115 kV pair MRG-1/MRG-2). Each has redundancy at the circuit level but total dependence on the single Moses switchyard — a Moses outage takes down every documented feed to both loads. Scale context: St. Lawrence Infrastructure's two queue entries (860 MW #1742 + 1,935 MW #1743 = 2,795 MW) alone dwarf the ~800 MW Moses-Saunders dam output; county-wide queue requests total ~5 GW, so grid deli…

## Arsenal Data Site 1000 cluster
- **Arsenal Data Site 1000 (Arconic Corporation, 467 MW)** · `secondary_feed` = no (medium confidence)
  No second feed documented. The NYISO queue (position 1730, IR 2025-03-07, CTO NYPA, ATO National Grid, SIS bundle 25-2) names a single point of interconnection: 'Haverstock to Adirondak 345kV line HA-1' — a tap on ONE circuit of the Haverstock–Adirondack corridor, not dual service from two substations (a single-circuit outage takes out a mid-line tap even though the circuit terminates at both subs…
  - https://www.nyiso.com/documents/20142/1407078/NYISO-Interconnection-Queue-07312026.xlsx/ff0e2005-e8d3-e75d-3e81-fa7027a52685?t=1786563693134
  - https://www.interconnection.fyi/project/nyiso-1730
- **New York State Artificial Intelligence Data Center (ZeroC Data Centers LLC, 300 MW)** · `secondary_feed` = no (medium confidence)
  No second feed documented for the active entry. NYISO queue position 1731 (IR 2025-03-14, SIS bundle 25-2) names a single POI: 'Haverstock-Adirondack 345kV transmission line HA-2' — one circuit. The project's earlier entry 1719 (IR 2024-09-18) at 'Dennison 115kV substation' (National Grid) shows status 0 and is reported withdrawn by interconnection.fyi, so Dennison is a superseded POI, not an alte…
  - https://www.nyiso.com/documents/20142/1407078/NYISO-Interconnection-Queue-07312026.xlsx/ff0e2005-e8d3-e75d-3e81-fa7027a52685?t=1786563693134
  - https://www.interconnection.fyi/project/nyiso-1719
  - https://www.datacenter.fyi/public-record/new-york-state-artificial-intelligence-data-center-70624c82

  *Cluster note:* Correction to the cluster premise: these loads do not 'name both substations' as dual points of interconnection — each names a tap on the Haverstock–Adirondack 345kV corridor itself (Arsenal on circuit HA-1, ZeroC on HA-2, Pontoon Bridge on 'lines'). Haverstock (Fregoe Rd, Massena; 345/230kV, double-breaker double-bus) and Adirondack (Croghan, Lewis Co.) are brand-new NYPA digital substations built under Smart Path Connect / Northern NY Priority Transmission Project (NYISO queue 1125, in service; ribbon-cut at Haverstock June 25, 2026 — the corridor is the rebuilt Moses–Adirondack line). Risk …

## Micron Clay megafab cluster
- **Micron Clay megafab (NYISO phases 576 MW + 480 MW)** · `backup_power` = diesel (high confidence)
  Documented plan is a large fleet of diesel emergency generators. Times Union (2026): 'Budget bill would exempt Micron from permit for backup diesel power' — reports Micron plans 118 diesel-powered backup generators for the megafab, and that the Hochul administration inserted state-budget language waiving Article 10 siting review (which applies at 25 MW+ of generation, implying the backup fleet exc…
  - https://www.timesunion.com/business/article/budget-bill-exempt-micron-permit-backup-diesel-22278633.php
  - https://dec.ny.gov/sites/default/files/2026-02/justificationstatementmicron.pdf
  - https://dec.ny.gov/sites/default/files/2026-05/micronairtitlev_justification.pdf
- **Micron Clay megafab (NYISO phases 576 MW + 480 MW)** · `secondary_feed` = no (medium confidence)
  All documented transmission service originates at one substation. National Grid's PSC Article VII filing (Micron Electric Service Project) and its February 2024 fact sheet describe eight new 345 kV underground service laterals, 0.95-2.07 miles each, running from the expanded Clay Substation to Micron's four fab areas; the Clay Substation is being expanded east and north with additional bays to car…
  - https://www.nationalgridus.com/media/construction-projects/pdfs/ny/micron/micron_fact_sheet.pdf
  - https://dps.ny.gov/event/micron-transmission-comments-due-regarding-national-grids-proposed-345-kv-underground-service
  - https://news.constructconnect.com/100-billion-micron-project-advances-with-critical-power-line-approval-in-new-york
- **Ranalli SuperDC (Ranalli Super DC LLC, Lysander NY; 270 MW per task premise, 300 MW per sources)** · `secondary_feed` = no (medium confidence)
  The only documented point of interconnection is a tap of the NYPA Clay-Pannell 345 kV circuits PC-1 and PC-2 (interconnection.fyi's NYISO queue tracking: applied 5/7/2025, 300 MW, NYPA as connecting utility, expected in-service 05-2028). Eagle News corroborates the site is 'adjacent to 345-kV, high-voltage transmission lines'. Tapping both PC-1 and PC-2 gives two circuits, but both belong to the s…
  - https://www.interconnection.fyi/data-center/state/NY
  - https://www.datacenter.fyi/power-market/nyiso
  - https://www.eaglenewsonline.com/baldwinsville_messenger/possible-massive-data-center-in-lysander-faces-community-opposition-town-attorney-to-draft-moratorium/article_635b1885-9f97-4747-bdf4-604d468fc641.html

  *Cluster note:* Both loads are single-corridor dependents of National Grid's Clay 345kV substation, making it a common-mode failure point for the cluster. Micron's entire permitted supply (eight 345kV underground laterals to four fabs; full-buildout demand cited at 1.8 GW) originates at the expanded Clay Substation; Ranalli SuperDC's documented POI is a tap of the NYPA Clay-Pannell 345kV circuits PC-1/PC-2, which leave that same substation. A Clay substation outage would interrupt grid supply to both loads simultaneously; a Clay-Pannell corridor loss would hit Ranalli and degrade the network around Micron. On…

## WNY STAMP cluster
- **WNY STAMP (Genesee County Economic Development Center, 300 MW, NYISO queue #0580)** · `backup_power` = diesel (medium confidence)
  The SEQR development application of record for Stream US Data Centers' 'Project Double Reed' at STAMP (revised Feb 18, 2026, on GCEDC's file library) states: '12 Emergency diesel-powered generators will provide backup power, ensuring uninterrupted operations during utility power outages to support critical IT, networking, and house loads, such as lighting and essential health, safety, and security…
  - https://www.gcedc.com/file-library/100319/STREAMUSDataCentersLLC.SEQRDevelopmentApplication.2.18.26.II.ProjectDescription.pdf
  - https://www.streamdatacenters.com/project-stamp/
- **WNY STAMP (Genesee County Economic Development Center, 300 MW, NYISO queue #0580)** · `secondary_feed` = no (medium confidence)
  No second substation or alternate point of interconnection is documented; all service is through the single on-site STAMP 345/115 kV substation. NYISO queue #0580 lists one POI: 'Kintigh/Niagara - New Rochester 345kV' (Connecting Transmission Owner NYPA); companion entry #1484 ('580 STAMP load increase', 300 MW, National Grid) interconnects at the '115 kv STAMP substation' — the 115 kV side of the…
  - https://www.nyiso.com/documents/20142/1407078/NYISO-Interconnection-Queue.xlsx
  - https://robertgagepepc.com/stamp-345-kv
  - http://www.gcedc.com/stamp
- **Somerset Load (Somerset Operating Company LLC, 250 MW, NYISO queue #849, in service)** · `backup_power` = battery (medium confidence)
  Queue #849 (IR 2019-05-21, POI Kintigh 345kV, NYSEG, status I/S) is the in-service load interconnection for the Lake Mariner campus: TeraWulf's Lake Mariner Data LLC ground-leases the site from Somerset Operating Company LLC, a related party controlled by TeraWulf's CEO (per TeraWulf 10-K disclosures of the 2024 New Ground Lease). For the campus, The Next Platform (May 28, 2026) reports: 'What the…
  - https://www.nextplatform.com/compute/2026/05/28/gpus-and-ram-are-in-short-supply-but-the-real-bottleneck-for-ai-is-electricians/5247566
  - https://www.datacenterfrontier.com/site-selection/article/55379784/terawulfs-lake-mariner-campus-how-a-retired-coal-plant-became-an-ai-factory-prototype
  - https://www.nyiso.com/documents/20142/1407078/NYISO-Interconnection-Queue.xlsx
- **Somerset Load (Somerset Operating Company LLC, 250 MW, NYISO queue #849, in service)** · `secondary_feed` = yes (medium confidence)
  Yes at the transmission-line level, but not dual-substation: the site is served by two 345 kV transmission circuits — Data Center Frontier: 'two 345-kV transmission lines that form part of the backbone of New York's grid'; The Next Platform: 'Lake Mariner benefits from dual 345 kilovolt power feeds coming in from separate grids', giving 'Tier 3 equivalence... N+1 redundancy and multiple power and …
  - https://www.datacenterfrontier.com/site-selection/article/55379784/terawulfs-lake-mariner-campus-how-a-retired-coal-plant-became-an-ai-factory-prototype
  - https://www.nextplatform.com/compute/2026/05/28/gpus-and-ram-are-in-short-supply-but-the-real-bottleneck-for-ai-is-electricians/5247566
  - https://www.nyiso.com/documents/20142/1407078/NYISO-Interconnection-Queue.xlsx
- **Lake Mariner Data II (Lake Mariner Data LLC / TeraWulf, 250 MW, NYISO queue #1670)** · `backup_power` = battery (high confidence)
  Queue #1670 (IR 2024-01-23, 250 MW DAT-AI, POI 'Kintigh 345kV Substation', NYSEG) covers the HPC/AI expansion buildings (WULF Den, CB-1, CB-2 onward) at Lake Mariner. These are exactly the buildings whose electrical fit-out is documented: Schneider Electric Galaxy VX UPS systems and Galaxy lithium-ion battery systems (Data Center Frontier's site visit piece), and The Next Platform states flatly: '…
  - https://www.nextplatform.com/compute/2026/05/28/gpus-and-ram-are-in-short-supply-but-the-real-bottleneck-for-ai-is-electricians/5247566
  - https://www.datacenterfrontier.com/site-selection/article/55379784/terawulfs-lake-mariner-campus-how-a-retired-coal-plant-became-an-ai-factory-prototype
  - https://www.nyiso.com/documents/20142/1407078/NYISO-Interconnection-Queue.xlsx
- **Lake Mariner Data II (Lake Mariner Data LLC / TeraWulf, 250 MW, NYISO queue #1670)** · `secondary_feed` = yes (medium confidence)
  Same physical service as Somerset Load: dual 345 kV transmission circuits into the site ('dual 345 kilovolt power feeds coming in from separate grids' per The Next Platform; 'two 345-kV transmission lines' per Data Center Frontier), but the only named point of interconnection in queue #1670 is the single 'Kintigh 345kV Substation' (NYSEG) — no second substation or alternate POI is named, so both f…
  - https://www.nextplatform.com/compute/2026/05/28/gpus-and-ram-are-in-short-supply-but-the-real-bottleneck-for-ai-is-electricians/5247566
  - https://www.datacenterfrontier.com/site-selection/article/55379784/terawulfs-lake-mariner-campus-how-a-retired-coal-plant-became-an-ai-factory-prototype
  - https://www.nyiso.com/documents/20142/1407078/NYISO-Interconnection-Queue.xlsx

  *Cluster note:* The Kintigh 345 kV switchyard (retired 675 MW Somerset/Kintigh coal plant, Barker NY, NYSEG territory, NYISO Zone A) is the common node for this cluster. Per the NYISO interconnection queue: Somerset Load #849 (250 MW, in service), Lake Mariner Data II #1670 (250 MW), and a fourth related entry not in this task's scope, TeraWulf Brookings 'Wulf Compute Data Center II' #1732 (250 MW), all name the Kintigh 345 kV substation as POI; WNY STAMP #0580 (300 MW, plus #1484's 300 MW increase) taps the same 'Kintigh/Niagara - New Rochester 345kV' corridor about 25 miles southeast via its own NYPA/Nation…

## Cluster

  *Cluster note:* For the East Fishkill / Wood Street 345kV cluster, treat this 1,000 MW load as paper-stage: it exists only as a NYISO large-load queue entry (filed July 17, 2025; phases of 500 MW hoped for 2028 and 2030; second-largest load request in the NYISO queue after a St. Lawrence County data center). No public document names its point of interconnection — the cluster's East Fishkill/Wood Street 345kV attribution could not be independently confirmed from public sources, and NYISO has said the reliability-impact study will be withheld as critical-energy-infrastructure information. Local capacity is repo…

## NY-Route 9W Load Center cluster
- **NY-Route 9W Load Center (NY-Route 9W LLC, 1,000 MW)** · `secondary_feed` = no (medium confidence)
  No second feed or alternate point of interconnection is documented anywhere. The NYISO queue workbook (Load Projects sheet, queue 1757) names exactly one POI — 'Leeds 345kV substation' (CTO National Grid) — with no alternate POI, no second substation, and no Affected Transmission Owner listed. Because the request was withdrawn (Project Status 0, last updated 2026-01-31) before any SIS/Facilities S…
  - https://www.nyiso.com/documents/20142/1407078/NYISO-Interconnection-Queue.xlsx
  - https://www.interconnection.fyi/project/nyiso-1757

  *Cluster note:* Leeds 345kV cluster (Catskill/Athens, Greene County, NYISO Zone F): the NY-Route 9W Load Center request is WITHDRAWN — IR filed 2026-01-07 and already at Project Status 0 (Withdrawn) in the queue workbook's 2026-01-31 update — so it may not belong in an active-exposure registry; flag it as a dead queue entry rather than a planned facility. NYISO's End-Use field for it is blank, so even the 'data centre' characterization is unconfirmed by any source; the developer behind NY-Route 9W LLC is unidentified in public records searched. Cluster context from the same workbook: Leeds 345kV has attracted…

## New York State AI Data Center cluster
- **New York State AI Data Center (ZeroC, 300 MW)** · `secondary_feed` = no (medium confidence)
  The current NYISO interconnection queue workbook lists two entries for this project, each with a single named POI and no alternate feed: queue 1719 (IR 9/18/2024) at 'Dennison 115kV substation' (NM-NG), shown with project status 0 and marked Withdrawn on interconnection.fyi; and queue 1731 (IR 3/14/2025, 300 MW, DAT-AI) at 'Haverstock-Adirondack 345kV transmission line HA-2' (NYPA, affected TO Nat…
  - https://www.nyiso.com/documents/20142/1407078/NYISO-Interconnection-Queue.xlsx
  - https://www.interconnection.fyi/project/nyiso-1719
- **North Country Data Center (435 MW)** · `backup_power` = diesel (medium confidence)
  Well documented for the NCCS/NYDIG campus (former Reynolds/Alcoa East smelter, 182 & 194 County Road 45), though the record describes the proposed ~635 MW expansion rather than the existing 435 MW crypto operation. North Country Now (6/6/2026): 115 'backup diesel generators onsite'; NCCS rep Carter McLean: 'We will now only be testing up to six of these backup diesel generators at any one time, ea…
  - https://www.northcountrynow.com/stories/mohawks-united-in-safety-and-health-discuss-data-center-concerns-at-meeting-massena,373764
  - https://www.datacenterdynamics.com/en/news/nydig-looks-to-expand-data-center-at-massena-site-new-york/
  - https://www.nccs.one/massena
- **North Country Data Center (435 MW)** · `secondary_feed` = no (medium confidence)
  NYISO queue 0979 (IR 1/22/2020, 435 MW, DAT-CM) names a single POI: 'Reynolds 115kV' (NYPA), status 12 'Under Construction'. No source describes a second feed or dual-substation service for the 435 MW load. Notable for the registry: the same operator has a separate pending request, queue 1751 ('Massena Development LLC Power Allocation', North Country Data Center LLC, IR 10/21/2025, 200 MW, SIS pen…
  - https://www.nyiso.com/documents/20142/1407078/NYISO-Interconnection-Queue.xlsx
  - https://www.nccs.one/massena
  - https://www.datacenterdynamics.com/en/news/nydig-looks-to-expand-data-center-at-massena-site-new-york/
- **SDC St. Lawrence (Sabey, 120 MW)** · `secondary_feed` = yes (medium confidence)
  The NYISO queue row itself names two circuits as the POI: 'Moses-Reynolds MRG-1 and Moses-Reynolds MRG-2 at 115kV' (NYPA) — a documented dual-circuit interconnection. Qualification: both circuits are Moses-Reynolds 115 kV lines with the same endpoints (Moses and Reynolds substations), so this is redundancy at the circuit level within one corridor, not service from a second, independent substation;…
  - https://www.nyiso.com/documents/20142/1407078/NYISO-Interconnection-Queue.xlsx

  *Cluster note:* Cluster concentration is real and documented in the NYISO queue workbook (nyiso.com, NYISO-Interconnection-Queue.xlsx, Load Projects sheet, retrieved 9/6/2026). Dennison 115 kV (National Grid/NM-NG) is the named POI for the entire ZeroC/PetaWatt family: queue 1213 (200 MW, active, IA in progress), plus withdrawn 0909 (100 MW) and withdrawn 1719 (300 MW) — so the surviving Dennison exposure is the 200 MW St Lawrence Data & Agricultural Center, whose documented substation design is a single 115/34.5 kV main transformer. Reynolds 115 kV (NYPA) carries the 435 MW North Country Data Center load (st…

## Data & Technology Campus cluster
- **Data & Technology Campus (Riverview Innovation & Technology Campus, 300 MW)** · `backup_power` = none (medium confidence)
  RITC's own project FAQ (riverviewtechcampus.com/future-use) states explicitly: "There are no emission sources because this facility will not use backup generators that some facilities require." This is the developer's public claim in connection with its Site Plan Application and Full Environmental Assessment Form filed with the Town of Tonawanda; it has not yet been tested through SEQR (the develo…
  - http://riverviewtechcampus.com/future-use
  - https://www.wkbw.com/niagara-county/proposed-2b-ai-data-center-at-former-industrial-site-raises-questions-in-town-of-tonawnada
  - https://www.rockinst.org/blog/updates-on-the-cloud-more-moratoriums-on-data-centers/
- **Globe Digital Holdings 1 (GLOBE DH LLC, 200 MW)** · `backup_power` = onsite_generation (medium confidence)
  Stokes Energy (the project's electrical engineering/interconnection/EPC partner) describes the Globe DH site at 3801 Highland Ave, Niagara Falls (NYISO Queue #1747, 15.9 acres) as a 200 MW data center + BESS: Phase 1 is "10 MW DC + 12 MWh BESS" (battery OEM "Morlus"), Phase 2 is "Gas Generation + Scale to 200 MW." So the documented plan combines batteries and on-site gas generation, though Stokes …
  - https://stokesus.com/
  - https://www.interconnection.fyi/data-center/state/NY
  - https://www.datacenterdynamics.com/en/news/9ldg-plans-ai-data-center-at-niagara-falls/
- **Globe Digital Holdings 2 (GLOBE DH LLC, 200 MW)** · `backup_power` = onsite_generation (medium confidence)
  Stokes Energy describes the Globe DH site at 2201 College Ave, Niagara Falls (NYISO Queue #1748, 22 acres) as a 200 MW data center with a "24-inch Natural Gas Pipeline" and "CCHP (up to 40 MW)" — i.e., up to 40 MW of on-site combined cooling, heat and power gas generation — plus Morlus BESS. As with Site 1, Stokes presents BESS/CCHP as revenue-stacked assets (arbitrage, frequency regulation, compu…
  - https://stokesus.com/
  - https://www.interconnection.fyi/data-center/state/NY

  *Cluster note:* Packard / Beck-Packard cluster observations: (1) The two Globe DH loads are part of a three-site, 600 MW single-developer portfolio (NYISO Queues #1747/#1748/#1749 per EPC partner Stokes Energy) sharing one \"2 GW switchyard corridor,\" one developer, one EPC, one battery OEM (Morlus), and the same NYPA-hydro dependence — a strong common-mode exposure; the third site (5950 Packard Rd, Queue #1749) is not in this registry but sits literally on Packard Road. (2) RITC/Data & Technology Campus is the outlier: its developer FAQ explicitly commits to NO backup generators, meaning a loss of its singl…

