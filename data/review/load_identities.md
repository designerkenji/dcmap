# Which campus each NYISO load is — for review

24 of the largest unmatched live loads researched. Skeptics upheld every confident registry match.

**Vouched 2026-09-10** (by the user): the 3 Lake Mariner links in `data/load_site_links.csv`; the 16 drafted campuses consolidated to 13 real ones (Arconic, ZeroC/Petawatt and Globe DH each drafted twice) and promoted into `data/manual_sites.csv`, with their queue filings linked once dedupe assigned ids.

## Attach to an existing registry site (3 loads → `load_site_links.csv`)

- **#849 Somerset Load** → `site-b034c54b77` (high, upheld) — Somerset Operating Company, LLC is the owner of the former Somerset/Kintigh coal plant (Paul Prager founded it in 2012; the plant 'would eventually mine bitcoin and change its name to Lake Mariner' - hntrbrk) and is the named landlord in TeraWulf's Oct 10, 202…
  - https://www.interconnection.fyi/project/nyiso-849
- **#1670 Lake Mariner Data II** → `site-b034c54b77` (high, upheld) — interconnection.fyi record: queue 1670, Lake Mariner Data LLC, 250 MW load, Niagara County, POI Kintigh 345kV Substation, NYSEG, request date Jan 23, 2024, Active In Queue. Lake Mariner Data LLC is a 100%-owned Delaware subsidiary of TeraWulf Inc. (Exhibit 21.…
  - https://www.interconnection.fyi/project/nyiso-1670
- **#1732 Wulf Compute Data Center II** → `site-b034c54b77` (high, upheld) — interconnection.fyi record: queue 1732, TeraWulf Brookings LLC, 250 MW load, Niagara County, POI Kintigh 345kV sub-station, NYSEG, request date Mar 29, 2025, Active In Queue. TeraWulf Brookings LLC is a 100%-owned Delaware subsidiary of TeraWulf Inc. (Exhibit …
  - https://www.interconnection.fyi/project/nyiso-1732

Note: the registry may hold Lake Mariner twice — one agent cites a second site id for the same campus; see the JSON. Worth a dedupe look.

## Identified campuses the registry does not hold (16 campuses from 19 queue rows)

Each is a real, located project with citations; promotable into `manual_sites.csv` (status announced/construction) so its loads can attach.

- **Treetop Development / Donovan Drive Holdings site, Lime Kiln Corporate Park, Don** — Treetop Companies (Treetop Development, Teaneck NJ) via SPV Donovan Dr @ 41.5230,-73.8120 · queue #1738 · high
  NYISO #1738 (queued 2025-07-17), 1,000 MW, Dutchess County, Con Edison, POI East Fishkill-Wood Street 345 kV lines 38/39, filer Donovan Drive Holdings LLC. Town of East Fishkill forestry inspection letter (5 Dec 2024) describes 'the Donovan Drive Holdings LLC property (Treetop Development Project)',…
  - https://www.interconnection.fyi/project/nyiso-1738
- **Arconic Massena Operations (former Alcoa West plant), 45 County Route 42, Massen** — Arconic Corporation (Apollo Global Management portfolio company; 'Arse @ 44.9520,-74.8880 · queue #1730 · high
  NYISO #1730 (queued 2025-03-07), 467 MW load, St. Lawrence County, filer Arconic Corporation, POI NYPA 'Haverstock to Adirondak 345kV line HA-1'. datacenter.fyi lists three Arconic entries - Arsenal Data Site 250 (233 MW), 500 (233 MW), 1000 (467 MW) = 933 MW - matching nny360/Syracuse.com (8 May 20…
  - https://www.interconnection.fyi/project/nyiso-1730
- **North Country Colocation Services (NCCS) Massena — former Reynolds Metals / Alco** — North Country Colocation Services (NCCS), wholly owned subsidiary of N @ 44.9820,-74.7510 · queue #0979 · high
  Queue applicant 'North Country Data Center' = North Country Data Center Corp. (NY DOS ID 5318609, One Vanderbilt Ave 65th Fl, NYC). NCCS's Feb-2024 comment letter (on letterhead '194 County Road 45, Massena, NY 13662') states NCCS is 'a wholly owned subsidiary of North Country Data Center Corp. (NCD…
  - https://www.bakerbotts.com/~/media/files/comment-letters/north-country-colocation-services-comments-(1).pdf
- **WNY STAMP (Science, Technology & Advanced Manufacturing Park) — Stream US Data C** — Genesee County Economic Development Center (substation owner / queue h @ 43.0860,-78.3970 · queue #0580, #1484 · high
  interconnection.fyi shows #0580 'WNY STAMP', Genesee County Economic Development, 300 MW load, POI 'Kintigh/Niagara - New Rochester 345kV', TO NYPA, queued 9/27/2016 (the Dec-2021 snapshot carried it at 500 MW). GCEDC's STAMP page: the 1,250-acre park in the Town of Alabama 'is approved for 600 mega…
  - https://www.interconnection.fyi/project/nyiso-0580
- **Riverview Innovation & Technology Campus (former Tonawanda Coke site)** — Riverview Innovation & Technology Campus, Inc. (owners Jon Williams &  @ 42.9830,-78.9260 · queue #1726 · high
  Riverview Innovation & Technology Campus, Inc. is the entity redeveloping the former Tonawanda Coke plant at 3875 and 3800 River Road, Town of Tonawanda, Erie County (~140 ac; coke plant 1917-2018, bought at auction 2019 by Williams/Yensan; DEC BCP site C915353). Proposal: 300 MW, 500,000 sq ft AI d…
  - https://www.interconnection.fyi/project/nyiso-1726
- **ZeroC / Petawatt Massena campus (417 County Route 42)** — ZeroC Data Centers, LLC (majority-owned by Petawatt Holdings, Inc.) @ 44.9490,-74.8630 · queue #1731 · high
  Massena Town Planning Board minutes 2025-02-20 (Site Plan Review #2): applicant 'ZeroC Data Centers LLC & Petawatt Holdings, Inc.', site 417 County Route 42, Massena (tax map 10.001-1-7.21, Industrial zone); Petawatt rep 'James K' stated the deed was transferred to ZeroC Data Center and Petawatt is …
  - https://www.massena.us/AgendaCenter/ViewFile/Minutes/_02202025-1061
- **Ranalli Lysander SuperDC site (Hencle Blvd & Oswego Rd, Town of Lysander)** — Ranalli Super DC, LLC (James Ranalli / United Auto Supply) @ 43.1850,-76.3510 · queue #1736 · high
  Ranalli Super DC, LLC owns a ~124-ac (listed 123.5 ac) vacant industrial-zoned parcel at the Hencle Boulevard / Oswego Road (NY-48) junction, Town of Lysander, Baldwinsville 13027 (Onondaga County), bought ~2020 for $833k; a 2021 auto-parts warehouse plan was cancelled in 2022. Applied to NYISO in M…
  - https://www.interconnection.fyi/project/nyiso-1736
- **466 Pontoon Bridge Road (former Air Products Massena Green Hydrogen parcel), Tow** — American Data Center Partners LLC (Delaware LLC formed 2025-06-17; NY  @ 44.9590,-74.9110 · queue #1745 · high
  Watertown Post's NYISO-queue piece names the pending project as 'the land sale involving American Data Centers Partners, LLC at 466 Pontoon Bridge Road' in Massena. Nominatim places no. 466 at 44.9593,-74.9129 on Pontoon Bridge Road, Town of Massena (parcel lies on the east side of the road). That s…
  - https://watertownpost.com/massena-faces-massive-data-center-power-requests-in-nyiso-queue/
- **Arconic Massena Operations, 45 County Route 42 (Alcoa/Arconic Massena West compl** — Arconic Corporation (owned by Apollo Funds via Arsenal AIC Parent LLC  @ 44.9530,-74.8830 · queue #1728, #1729 · high
  Queue filer is Arconic Corporation; 'Arsenal' is the name of Apollo's acquisition vehicle for Arconic (SEC DEFM14A: Parent = 'Arsenal AIC Parent LLC', Merger Sub = 'Arsenal AIC MergeCo Inc.', affiliates of Apollo funds; deal closed Aug 2023), so the project name is Arconic's own post-Apollo branding…
  - https://www.sec.gov/Archives/edgar/data/1790982/000114036123030186/ny20009102x2_defm14a.htm
- **ZeroC / Petawatt Massena data center site, 417 County Route 42, Massena NY (Tax ** — ZeroC Data Centers, LLC (majority-owned by Petawatt Holdings, Inc.) @ 44.9570,-74.8460 · queue #1213 · high
  NYS Tax Parcels Public layer returns two St. Lawrence County parcels owned by 'Zeroc Data Centers, LLC': 10.001-1-7.21 at 417 County Route 42 (67.76 ac, centroid 44.9564,-74.8490) and 10.001-1-31.12 on County Route 42 (66.99 ac, centroid 44.9578,-74.8428), Town of Massena; coordinates given are the …
  - https://www.interconnection.fyi/project/nyiso-1213
- **Indian Point Energy Center (Holtec HI-CLOUD anchor site), 450 Broadway, Buchanan** — Holtec International / Holtec Decommissioning International (HDI) @ 41.2610,-73.9530 · queue #1717 · high
  450 Broadway, Buchanan is the Indian Point Energy Center; Holtec's HI-CLOUD announcement names the Indian Point campus as the anchor site with an initial 200 MW target, and the NYISO entry (#1717, 200 MW, Buchanan 138 kV, ConEd) matches. Search-snippet text from the Peekskill Herald and Highlands Cu…
  - https://www.interconnection.fyi/project/nyiso-1717
- **Globe Digital Holdings (Globe DH LLC) Niagara Falls North End sites - flagship 3** — Globe DH LLC (Globe Digital Holdings), Niagara Falls NY - same 3801 Hi @ 43.1230,-79.0430 · queue #1747 · medium
  globedh.com (copyright 'GLOBE DH LLC', Niagara Falls NY) publishes a portfolio map titled 'NF 4 Locations' marking three data-center sites four miles apart: '3801 Highland', '2201 College' and '5950 Packard' (plus a fourth Witmer Rd farm parcel); the site aerial for 3801 Highland shows the former Gl…
  - https://www.interconnection.fyi/project/nyiso-1747
- **Globe Digital Holdings North End campus (Highland Ave / College Ave, Packard Rd,** — GLOBE DH LLC (Globe Digital Holdings); probable Santarosa Holdings / B @ 43.1240,-79.0430 · queue #1748, #1749 · medium
  GLOBE DH LLC = Globe Digital Holdings: globedh.com is copyrighted 'GLOBE DH LLC', contact 'Niagara Falls, NY, USA', and its Portfolio page lists four Niagara Falls parcels — College Ave, Packard Rd, Highland Ave (featured), Witmer Rd — with a map 'showing three locations with a 4-mile route'. Niagar…
  - https://globedh.com/portfolio
- **Kenwood Commons / Kenwood Tech Center (former Kenwood convent - Doane Stuart Sch** — EKG Group LLC / Guild Ventures (Michael-Henry Elghanian-Krayem) @ 42.6280,-73.7710 · queue #1754 · high
  EKG Group LLC (the NYISO filer) is Michael-Henry Elghanian-Krayem's family office; ekggroup.us lists 'Kenwood Commons, Albany, New York — 76 acres, largest contiguous undeveloped parcel in the City of Albany, 345 kV transmission on-site' as its US project (its own rounded coordinate 42.65N 73.76W). …
  - https://www.ekggroup.us/
- **Brookhaven Digital Infrastructure Facility (Wildflower / WF Industrial XII), Yap** — Wildflower Ltd. (via affiliate WF Industrial XII LLC) @ 40.8310,-72.9390 · queue #1721 · high
  WF Industrial XII LLC is the Wildflower Ltd. affiliate that owns the ~71.45-acre parcel ~100 ft west of Sills Road on the north side of the LIE North Service Road, Yaphank (SCTM 0200-662.00-02.00-005.016), IDA-approved in 2023 as a 549,942 sf warehouse/logistics project. Wildflower now markets it as…
  - https://www.longislandpress.com/2026/07/15/moratorium-data-centers-state/
- **Cayuga (Milliken Station) power plant site / TeraWulf Cayuga, Lansing** — Cayuga Operating Company LLC (site owner); TeraWulf Inc. (ground lesse @ 42.6020,-76.6360 · queue #1733 · high
  Cayuga Operating Company LLC is the owning entity of the retired Cayuga coal station (originally Milliken Station, 1955; retired Oct 2019) at 228 Cayuga Drive, Lansing, Tompkins County, on the east shore of Cayuga Lake - the only site the company holds. The NYISO POI 'Milliken 115kV Substation' is t…
  - https://www.gem.wiki/Cayuga_power_station_(New_York)

## Not established

- #1743 St. Lawrence Infrastructure 2: NYISO #1743 (queued 2025-09-02), 1,935 MW load, St. Lawrence County, POI NYPA 230 kV Moses Massena 1 & 2; sibling #SLI-1 is 860 MW (two sites = 2,795 MW). Syracuse.com/nny360 (Tim Knauss, 8 May 2026):…
- #1761 NYISO Load Interconnection Process - Data Center Inquiry: No physical campus could be established. The filer name is a person, not an SPV: UK Companies House lists Uri Taly as director of DNTS-ENG Survey GIS & Engineering Ltd (no. 10523537, London), and his …
