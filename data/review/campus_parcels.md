# County parcels as campus boundaries — what was found, and what a person should look at

Sweep 2026-09-18. The pipeline (`src/parcels.py`) point-queried each exactly-located US site against the county or state parcel layer that covers it (`data/parcel_layers.json` plus the hand-wired list), took the lot under the dot as the campus boundary, and grew it to the same owner's touching lots. One research agent then judged each parcel against public records; every rejection and every AI-site keep was re-argued by a skeptic. Parcels are recorded in `raw/parcels.geojson` and merged into `data/footprints.geojson` as kind=campus, src=parcel; the reject ledger `data/parcel_rejects.csv` removes the ones two agents agreed are not the project's ground.

Sites vetted: 81 · keep 62 · review 4 · reject 15

## Not a data centre — the registry entry itself is the problem

The parcel is fine; what stands on it is not a data-centre project. These belong with the unverified-listing review (`needs_review`), not with placement. Nothing removed here.

- **site-faf5942f1a** Datacenter () — The site is an OSM-only feature: way 1534758773, a ~770 m2 building tagged building=yes / name=Datacenter / telecom=data_center, created 2026-07-03 in changeset 185013433 whose comment is "Tagging Loring Job Corps Center + Defense Finance and Accounting Service". The building sits inside the OSM Loring Job Corps Center campus multipolygon (relation 21058789,
- **site-0d53aa8ade** Lagrange CO (Ligtel Communications, Inc.) — Parcel 44-06-25-200-000.013-018 (state id 440625200000013018) is a 0.35-acre lot with situs "W CENTRAL AVE" (no house number), DLGF class 400, in LaGrange civil town, Clay Twp; the Precisely parcel record for the site gives the same parcel at 0.37 ac. The LaGrange County treasurer's roll (PayGov) records the owner as "Six & Thirty-Three, LLC", which also own
- **site-4c26665080** Learning GIS! () — There is no data-centre project here. The registry entry comes solely from OSM node 7264976228, tagged only name="Learning GIS!" + telecom=data_center, created 2020-03-04 by user "Kyle Robi" in a one-node changeset (81795311) whose comment is "Learning GIS", made with the iD editor. It is a novice test edit, not a facility. The node sits on Purdue University
- **site-9cadba43c9** NocRoom Miami IT Services () — The queried parcel (folio 30-3035-008-0030) is Lot 3 Block 1 of the Airport Corporate Center office park at 7415 NW 19 St, Miami 33126: a 4.31-acre lot with a 46,417 sq ft one-storey office building built in 1983, land use 'OFFICE BUILDING - ONE STORY'. Its owner, SPUS7 MIAMI ACC LAND LP (c/o Boca Raton mailing address), is the institutional fund entity that
- **site-50d28b3cc2** UPX Miami (UPX TECHNOLOGIES) — The point-query landed on the lot that the registered address points to, but that lot is not a data-centre campus. Miami-Dade folio 31-2211-076-0001 is the 'RO Reference' parent folio of JADE SIGNATURE CONDO (16901 Collins Ave, Sunny Isles Beach), a 57-storey residential condominium tower completed 2017; the owner field is the placeholder 'REFERENCE ONLY' be
- **site-80d2a2cf2b** USNAMES-NET (American Domain Names LLC) — The FirstMap parcel 0703740118 (0.87 ac) does contain the site coordinate, and New Castle County's own Ownership layer gives its situs as 3422 (and 3424) OLD CAPITOL TRL, Wilmington DE 19808 (subdivision Minker Subd / Cranston Heights), owner "804 PARTNERS, C/O 804 LLC, 3422 Old Capitol Tr" - so the dot is on the right lot for the registry's address, and 804
- **site-2f8e8e1abf** VentureData () — The parcel is the lot under the mapped building, so the boundary is right; the doubt is about the site itself. The registry row is a single OSM building (way 290101976) at 19 College Avenue, Rexburg, tagged name/brand "VentureData", telecom=data_center. Madison County's own live parcel service (madison.rexburg.org/mrgis, via the assessor's GIS portal) return

## The dot is the problem — rejections whose reasoning says the site coordinate is wrong

A parcel query can only be as good as the dot it is asked about. These are candidates for a placement correction (`data/site_overrides.csv`), after which the parcel query will find the right lot on its own. Nothing moved here.

- **site-960ffbbfd9** Brookhaven Digital Infrastructure Facility (Wildflower Ltd.) — The point-queried parcel 636.00-01-006.005 is a neighbouring, unrelated town-owned lot, not the project's ground. NYS Tax Parcels (roll year 2025) records it as PATCHOGUE-YAPHANK RD, property class 330 (vacant commercial land), roll section 8 (wholly exempt), 11.88 ac, owner "TOWN OF BROOKHAVEN C/O DEPT OF FINANCE", mailing 1 Independence Hill, Farmingville. The Town of Brookhaven is the municipality currently imposi
- **site-f54144f9e9** Meta Jeffersonville (Meta) — The point-queried parcel 10-19-00-101-376.000-010 is a 894 m² (~0.22 acre) lot in downtown Jeffersonville. The Indiana statewide parcel layer (the same layer the pipeline used) returns for the site coordinate: DLGF property address "738 WATT STREET, JEFFERSONVILLE 47130", DLGF property class code 510 (residential one-family dwelling on a platted lot), Jeffersonville Civil City taxing district 10010. The registry's ow
- **site-6acacdd9ab** Meta Kuna (Meta) — The registry coordinate (43.459207, -116.421111) sits 8.5 m inside the north edge of Ada County parcel S2202121005 (325.69 ac per the State of Idaho Public Parcels layer; bbox lon -116.4289..-116.4139, lat 43.4445..43.4593), a lot just south of Kuna-Mora Rd directly south of Kuna. Meta's Kuna campus is not there: every primary source puts it at the Kuna-Mora Rd / S Cole Rd corner, ~12.3 km east. The Kuna City Council
- **site-dcb5e135f7** WNY STAMP Data Center (Stream US Data Centers (GCEDC STAMP)) — Parcel 10.-1-13.2 (Alabama, Genesee Co.; NYS Tax Parcels roll 2025) is a 7.5-acre, class-340 strip owned by "Genesee County IDA" (mail 99 MedTech Dr, Batavia = GCEDC, the public agency that owns and develops the STAMP park). Its ring is a rectangle ~500 m long by ~63 m wide (FRONT 1740 ft) running east from Crosby Road at lat 43.0855-43.0861; together with 10.-1-32.212 (2.0 ac) and 10.-1-32.222 (0.5 ac) it forms the 
- **site-1a531a56cb** ARE-ON Hope (Arkansas Research and Education Optical Network (AREON)) — The point-queried parcel 700-04405-001 (Hempstead) is the lot under a Shell fuel station / convenience store at the corner of W 3rd St (US 67) and S Fulton St in Hope: the state parcel service gives owner ARLINGTON LAKESIDE GRO & GRILL, situs 901 W 3RD ST HOPE, 0.35 ac, commercial-improved (Lots 11-12 & E1/2 10, Blk 11, Wallis subdivision), and Nominatim reverse-geocodes the site coordinate to "Shell, West 3rd Street
- **site-e427887c01** AiNET WDC11 (AiNET) — The parcel record the pipeline attached (MD acct 17101008960 = PG Co. district 10 acct 1008960) is NOT the data centre's lot. Prince George's County's own Property_Flattened layer gives its owner as "C & P TEL CO OF BALTO CITY" (Chesapeake & Potomac Telephone, i.e. Verizon Maryland), c/o "ASST MGR STATE & LOCAL TAXES, 1 E PRATT ST RM 8N20, BALTIMORE"; legal description "GP&S SUB S137.5 FT E50 FT LT31 & S HALF LT 32 P
- **site-f8eec2271f** CyrusOne Norwalk (CyrusOne Inc.) — The hit parcel (CT CAMA/Parcel layer OBJECTID 1237197, Link "STATE", no Parcel_ID, no owner, no CAMA record) is a state-owned linear right-of-way, not a building lot: Shape__Area 365,848 sq ft (8.4 ac) against a 9,082 ft perimeter, i.e. a ~1.3 km long, ~28 m wide strip running ENE with a rounded west end. It runs parallel to a second 9.2-ac STATE strip and coincides with the two carriageways of I-95 in OSM (I-95 way 
- **site-42079cf9d6** DartPoints Columbus, IN - CLU1 (DartPoints, LLC) — The point-queried parcel 039631000000300005 (03-96-31-000-000.300-005) is NOT the data centre's lot. Bartholomew County's own parcel layer (39 Degrees North / Elevate ArcGIS service that backs bartholomewin.elevatemaps.io, linked from the county assessor page) records it as "LOT 2A - TECHNOLOGY PARK 3RD REPLAT", situs "TECHNOLOGY BLVD" with no house number, property class 100 "Vacant Land", 13.53 legal acres, improve
- **site-47593f20fd** DataBank Indianapolis (IND1) (DataBank, Ltd.) — The queried parcel 49-11-11-183-001.014-101 (Marion County local 1382950) is Indy Telcom Center LOT 11 with situs 711 W HENRY ST, 0.91 ac, owned by NETRALITY INDY MULTIPARCEL OWNER LLC (Netrality Data Centers, 50 S 16th St Philadelphia). Netrality owns most of the Indy Telcom Center campus lots but NOT 731 W Henry; it is the neighbouring landowner, with no link to DataBank IND1. DataBank's own site and PeeringDB (fac
- **site-e270ee9298** Equinix MI3 - Miami, Boca Raton (Equinix, Inc.) — The queried ref 06-42-47-12-15-000-0020 is "BOCA RATON INNOVATION CAMPUS LAND CONDO UNIT 2" - the land-condominium ground of the Boca Raton Innovation Campus (BRiC, the former IBM campus at 5000 T-Rex Ave). The number is retired on the current Palm Beach roll: on 01/03/2025 Unit 2 was split into 2A (-0021, 74.77 ac) and 2B (-0022, 3.43 ac), both owned by G&I X BRIC PARCEL LLC (mailing 5355 Town Center Rd Ste 350, Boc
- **site-36cbb35213** Syringa Networks Boise (Syringa Networks Boise) — The point-queried parcel S1027314800 is not Syringa's ground. Ada County's own parcel layer (Land_Information/Parcels, served through the county portal proxy) records it as owner "HARTFORD SUE ANNE" (a private individual, mailing 1086 E Opus St, Boise), situs 3870 S DEVELOPMENT AVE, 0.19 acres, zoning I-1, Property_Code Commercial, value $489,200. The same owner holds the two adjoining slivers S1027314810 (3882 S Dev

## Rejected — the lot under the dot is not this project's ground (two agents agreed; in the reject ledger)

- **site-960ffbbfd9** Brookhaven Digital Infrastructure Facility (Wildflower Ltd.) — Suffolk County, NY  
  parcel: TOWN OF BROOKHAVENC/O DEPT OF FINANCE · 11.88163738 ac · ref 636.00-01-006.005 · ny  
  **wrong** / reject · owner is public · high — The point-queried parcel 636.00-01-006.005 is a neighbouring, unrelated town-owned lot, not the project's ground. NYS Tax Parcels (roll year 2025) records it as PATCHOGUE-YAPHANK RD, property class 330 (vacant commercial land), roll section 8 (wholly exempt), 11.88 ac, owner "TOWN OF BROOKHAVEN C/O DEPT OF FINANCE", mailing 1 Independence Hill, Far  
  refuter upheld  
  https://gisservices.its.ny.gov/arcgis/rest/services/NYS_Tax_Parcels_Public/MapServer/1/query?geometry=-72.9395,40.8315&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=false&f=json; https://gisservices.its.ny.gov/arcgis/rest/services/NYS_Tax_Parcels_Public/MapServer/1/query?where=MUNI_NAME%3D%27Brookhaven%27+AND+LOC_ST_NBR%3D%271001%27+AND+UPPER%28LOC_STREET%29+LIKE+%27%25EXPRESSWAY%25%27&outFields=*&returnGeometry=true&outSR=4326&f=json; https://www.wildflowerltd.com/digital-infrastructure-items/brookhaven-digital-infrastructure-facility
- **site-f54144f9e9** Meta Jeffersonville (Meta) — Clark County, IN  
  parcel: owner not published · ? ac · ref 101900101376000010 · in  
  **wrong** / reject · owner is unrelated · high — The point-queried parcel 10-19-00-101-376.000-010 is a 894 m² (~0.22 acre) lot in downtown Jeffersonville. The Indiana statewide parcel layer (the same layer the pipeline used) returns for the site coordinate: DLGF property address "738 WATT STREET, JEFFERSONVILLE 47130", DLGF property class code 510 (residential one-family dwelling on a platted lo  
  refuter upheld  
  https://gisdata.in.gov/server/rest/services/Hosted/Parcel_Boundaries_of_Indiana_Current/FeatureServer/0/query?geometry=-85.739009,38.279131&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&f=json; https://www.lpm.org/news/2026-08-26/jeffersonville-data-center-zoning-explained-how-meta-got-approved; https://datacenters.atmeta.com/2024/01/hello-jeffersonville/
- **site-6acacdd9ab** Meta Kuna (Meta) — Ada County, ID  
  parcel: owner not published · ? ac · ref S2202121005 · id  
  **wrong** / reject · owner is public · high — The registry coordinate (43.459207, -116.421111) sits 8.5 m inside the north edge of Ada County parcel S2202121005 (325.69 ac per the State of Idaho Public Parcels layer; bbox lon -116.4289..-116.4139, lat 43.4445..43.4593), a lot just south of Kuna-Mora Rd directly south of Kuna. Meta's Kuna campus is not there: every primary source puts it at the  
  refuter upheld  
  https://kunacity.id.gov/ArchiveCenter/ViewFile/Item/3018; https://content.govdelivery.com/attachments/IDLANDS/2023/03/22/file_attachments/2445052/2-Brisbie%20LLC%20Land%20Exchange.pdf; https://gemstatepatriot.org/ai-datacenter-research/meta-kuna-data-center-development-1/
- **site-dcb5e135f7** WNY STAMP Data Center (Stream US Data Centers (GCEDC STAMP)) — Genesee County, NY  
  parcel: Genesee County IDA · 7.50208298 ac · ref 10.-1-13.2 · ny  
  **wrong** / reject · owner is public · high — Parcel 10.-1-13.2 (Alabama, Genesee Co.; NYS Tax Parcels roll 2025) is a 7.5-acre, class-340 strip owned by "Genesee County IDA" (mail 99 MedTech Dr, Batavia = GCEDC, the public agency that owns and develops the STAMP park). Its ring is a rectangle ~500 m long by ~63 m wide (FRONT 1740 ft) running east from Crosby Road at lat 43.0855-43.0861; toget  
  refuter upheld  
  https://gisservices.its.ny.gov/arcgis/rest/services/NYS_Tax_Parcels_Public/MapServer/1/query; https://www.gcedc.com/file-library/100319/STREAMUSDataCentersLLC.ProjectSummary.1.30.26.pdf; https://townofalabamany.gov/wp-content/uploads/2026/06/NMZ-5DRAFT-AlabamaPB-Findings-Form-STREAM-06082026.pdf
- **site-23ef4dc9c9**  () — Bartholomew County, IN  
  parcel: owner not published · ? ac · ref 039632210000201005 · in  
  **wrong** / reject · owner is unrelated · high — The parcel (Bartholomew County 03-96-32-210-000.201-005, local id 15166) is 3110 Permawick Dr, Columbus IN 47201: a 2.818-acre I3 (Industrial Heavy) lot in Bartholomew Industrial Park, DLGF use class 340 "Light Manufacturing & Assembly", carrying a single 27,000 sq ft one-storey building built 1980, last sold 2004-10-28 (Bk 2004 Pg 15205), assessed  
  refuter upheld  
  https://gisdata.in.gov/server/rest/services/Hosted/Parcel_Boundaries_of_Indiana_Current/FeatureServer/0/query?where=state_parcel_id%3D%27039632210000201005%27&outFields=*&f=json; https://app.regrid.com/us/in/bartholomew/columbus/6070; https://app.regrid.com/us/in/bartholomew/columbus/5747
- **site-1a531a56cb** ARE-ON Hope (Arkansas Research and Education Optical Network (AREON)) — Hempstead County, AR  
  parcel: ARLINGTON LAKESIDE GRO & GRILL, · 0.35 ac · ref 700-04405-001 · ar · +2 same-owner lot(s)  
  **wrong** / reject · owner is unrelated · high — The point-queried parcel 700-04405-001 (Hempstead) is the lot under a Shell fuel station / convenience store at the corner of W 3rd St (US 67) and S Fulton St in Hope: the state parcel service gives owner ARLINGTON LAKESIDE GRO & GRILL, situs 901 W 3RD ST HOPE, 0.35 ac, commercial-improved (Lots 11-12 & E1/2 10, Blk 11, Wallis subdivision), and Nom  
  refuter upheld  
  https://www.peeringdb.com/fac/1669; https://gis.arkansas.gov/arcgis/rest/services/FEATURESERVICES/Planning_Cadastre/FeatureServer/6/query?where=parcelid%3D%27700-04405-001%27%20AND%20countyfips%3D%2705057%27&outFields=*&f=json; https://gis.arkansas.gov/arcgis/rest/services/FEATURESERVICES/Planning_Cadastre/FeatureServer/6/query?where=countyfips%3D%2705057%27%20AND%20parcelid%20IN%20(%27700-04400-000%27,%27700-04399-000%27)&outFields=*&f=json
- **site-f8eec2271f** CyrusOne Norwalk (CyrusOne Inc.) — Western Connecticut Planning Region, CT  
  parcel: owner not published · ? ac · ref STATE · ct  
  **wrong** / reject · owner is public · high — The hit parcel (CT CAMA/Parcel layer OBJECTID 1237197, Link "STATE", no Parcel_ID, no owner, no CAMA record) is a state-owned linear right-of-way, not a building lot: Shape__Area 365,848 sq ft (8.4 ac) against a 9,082 ft perimeter, i.e. a ~1.3 km long, ~28 m wide strip running ENE with a rounded west end. It runs parallel to a second 9.2-ac STATE s  
  refuter upheld  
  https://services3.arcgis.com/3FL1kr7L4LvwA2Kb/arcgis/rest/services/Connecticut_CAMA_and_Parcel_Layer/FeatureServer/0/query?where=OBJECTID%3D1237197&outFields=*&outSR=4326&f=json; https://services3.arcgis.com/3FL1kr7L4LvwA2Kb/arcgis/rest/services/Connecticut_CAMA_and_Parcel_Layer/FeatureServer/0/query?where=Town_Name%3D%27Norwalk%27+AND+Location_1+LIKE+%27%25NORDEN%25%27&outFields=*&outSR=4326&f=json; https://www.peeringdb.com/api/fac?name__contains=Norwalk
- **site-42079cf9d6** DartPoints Columbus, IN - CLU1 (DartPoints, LLC) — Bartholomew County, IN  
  parcel: owner not published · ? ac · ref 039631000000300005 · in  
  **wrong** / reject · owner is unrelated · high — The point-queried parcel 039631000000300005 (03-96-31-000-000.300-005) is NOT the data centre's lot. Bartholomew County's own parcel layer (39 Degrees North / Elevate ArcGIS service that backs bartholomewin.elevatemaps.io, linked from the county assessor page) records it as "LOT 2A - TECHNOLOGY PARK 3RD REPLAT", situs "TECHNOLOGY BLVD" with no hous  
  refuter upheld  
  https://elb.elevatemaps.io/arcgis/rest/services/eGISDynamicServices/BartholomewINDynamic/MapServer/92/query?where=pin_18+IN+%28%2703-96-31-000-000.300-005%27%2C%2703-96-31-140-000.100-005%27%2C%2703-96-31-140-000.102-005%27%29&outFields=pin_18%2Cowner%2Cowner_street%2Cowner_city_st_zip%2Cproperty_street%2Clegal_desc%2Cprop_class_desc%2Clegal_acreage%2Cimprov_value&returnGeometry=false&f=json; https://gisdata.in.gov/server/rest/services/Hosted/Parcel_Boundaries_of_Indiana_Current/FeatureServer/0/query?geometry=-85.897349%2C39.182544&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=state_parcel_id%2Cparcel_id%2Cprop_add%2Cdlgf_prop_class_code&returnGeometry=false&f=json; https://www.peeringdb.com/api/fac?name__contains=DartPoints
- **site-47593f20fd** DataBank Indianapolis (IND1) (DataBank, Ltd.) — Marion County, IN  
  parcel: owner not published · ? ac · ref 491111183001014101 · in  
  **wrong** / reject · owner is unrelated · high — The queried parcel 49-11-11-183-001.014-101 (Marion County local 1382950) is Indy Telcom Center LOT 11 with situs 711 W HENRY ST, 0.91 ac, owned by NETRALITY INDY MULTIPARCEL OWNER LLC (Netrality Data Centers, 50 S 16th St Philadelphia). Netrality owns most of the Indy Telcom Center campus lots but NOT 731 W Henry; it is the neighbouring landowner,  
  refuter upheld  
  https://gis.indy.gov/server/rest/services/MapIndy/MapIndyProperty/MapServer/10; https://gis.indy.gov/server/rest/services/MapIndy/MapIndyProperty/MapServer/10; https://gisdata.in.gov/server/rest/services/Hosted/Parcel_Boundaries_of_Indiana_Current/FeatureServer/0
- **site-faf5942f1a** Datacenter () — Aroostook County, ME  
  parcel: owner not published · ? ac · ref 03320_Loring · me  
  **wrong** / reject · owner is unknown · high — The site is an OSM-only feature: way 1534758773, a ~770 m2 building tagged building=yes / name=Datacenter / telecom=data_center, created 2026-07-03 in changeset 185013433 whose comment is "Tagging Loring Job Corps Center + Defense Finance and Accounting Service". The building sits inside the OSM Loring Job Corps Center campus multipolygon (relation  
  refuter upheld  
  https://services1.arcgis.com/RbMX0mRVOFNTdLzd/arcgis/rest/services/Maine_Parcels_Organized_Towns/FeatureServer/10/query?geometry=-67.905588,46.939993&geometryType=esriGeometryPoint&inSR=4326&outFields=*&f=json; https://services1.arcgis.com/RbMX0mRVOFNTdLzd/arcgis/rest/services/Maine_Parcels_Organized_Towns/FeatureServer/9/query?where=STATE_ID+LIKE+%2703320%25%27&returnCountOnly=true&f=json; https://services1.arcgis.com/RbMX0mRVOFNTdLzd/arcgis/rest/services/Maine_E911_Addresses_Feature/FeatureServer/0
- **site-4c26665080** Learning GIS! () — Tippecanoe County, IN  
  parcel: owner not published · ? ac · ref 790719300001000029 · in  
  **wrong** / reject · owner is unrelated · high — There is no data-centre project here. The registry entry comes solely from OSM node 7264976228, tagged only name="Learning GIS!" + telecom=data_center, created 2020-03-04 by user "Kyle Robi" in a one-node changeset (81795311) whose comment is "Learning GIS", made with the iD editor. It is a novice test edit, not a facility. The node sits on Purdue   
  refuter upheld  
  https://www.openstreetmap.org/api/0.6/node/7264976228.json; https://www.openstreetmap.org/api/0.6/changeset/81795311.json; https://nominatim.openstreetmap.org/reverse?lat=40.42179&lon=-86.9141546&format=jsonv2&zoom=18
- **site-9cadba43c9** NocRoom Miami IT Services () — Miami-Dade County, FL  
  parcel: SPUS7 MIAMI ACC LAND LP · ? ac · ref 3030350080030 · fl · +5 same-owner lot(s)  
  **wrong** / reject · owner is unrelated · high — The queried parcel (folio 30-3035-008-0030) is Lot 3 Block 1 of the Airport Corporate Center office park at 7415 NW 19 St, Miami 33126: a 4.31-acre lot with a 46,417 sq ft one-storey office building built in 1983, land use 'OFFICE BUILDING - ONE STORY'. Its owner, SPUS7 MIAMI ACC LAND LP (c/o Boca Raton mailing address), is the institutional fund e  
  refuter upheld  
  https://apps.miamidadepa.gov/PApublicServiceProxy/PaServicesProxy.ashx?Operation=GetPropertySearchByFolio&clientAppName=PropertySearch&folioNumber=3030350080030; https://apps.miamidadepa.gov/PApublicServiceProxy/PaServicesProxy.ashx?Operation=GetPropertySearchByFolio&clientAppName=PropertySearch&folioNumber=3030350080010; https://apps.miamidadepa.gov/PApublicServiceProxy/PaServicesProxy.ashx?Operation=GetPropertySearchByFolio&clientAppName=PropertySearch&folioNumber=3030350110010
- **site-36cbb35213** Syringa Networks Boise (Syringa Networks Boise) — Ada County, ID  
  parcel: owner not published · ? ac · ref S1027314800 · id  
  **wrong** / reject · owner is unrelated · high — The point-queried parcel S1027314800 is not Syringa's ground. Ada County's own parcel layer (Land_Information/Parcels, served through the county portal proxy) records it as owner "HARTFORD SUE ANNE" (a private individual, mailing 1086 E Opus St, Boise), situs 3870 S DEVELOPMENT AVE, 0.19 acres, zoning I-1, Property_Code Commercial, value $489,200.   
  refuter upheld  
  https://gisprod.adacounty.id.gov/arcgis/sharing/servers/a635313e797349c7ae41ffde201b4f87/rest/services/LandInformation/Land_Information/MapServer/11/query?where=Parcel%3D%27S1027314800%27&outFields=*&f=json; https://gisprod.adacounty.id.gov/arcgis/sharing/servers/a635313e797349c7ae41ffde201b4f87/rest/services/LandInformation/Land_Information/MapServer/11/query?where=Parcel%3D%27R8184730300%27&outFields=*&f=json; https://gisprodapi.adacounty.id.gov/arcgis/rest/services/Locators/ParcelsPro/GeocodeServer/findAddressCandidates?SingleLine=S1027314800&outFields=*&outSR=4326&f=json
- **site-50d28b3cc2** UPX Miami (UPX TECHNOLOGIES) — Miami-Dade County, FL  
  parcel: REFERENCE ONLY · ? ac · ref 3122110760001 · fl · +2 same-owner lot(s)  
  **wrong** / reject · owner is unrelated · high — The point-query landed on the lot that the registered address points to, but that lot is not a data-centre campus. Miami-Dade folio 31-2211-076-0001 is the 'RO Reference' parent folio of JADE SIGNATURE CONDO (16901 Collins Ave, Sunny Isles Beach), a 57-storey residential condominium tower completed 2017; the owner field is the placeholder 'REFERENC  
  refuter upheld  
  https://apps.miamidadepa.gov/PApublicServiceProxy/PaServicesProxy.ashx?Operation=GetPropertySearchByFolio&folioNumber=3122110760001&clientAppName=PropertySearch; https://www.peeringdb.com/api/fac?name__contains=UPX&depth=0; https://en.wikipedia.org/wiki/Jade_Signature
- **site-80d2a2cf2b** USNAMES-NET (American Domain Names LLC) — New Castle County, DE  
  parcel: owner not published · 0.8730164 ac · ref 0703740118 · de  
  **wrong** / reject · owner is unrelated · high — The FirstMap parcel 0703740118 (0.87 ac) does contain the site coordinate, and New Castle County's own Ownership layer gives its situs as 3422 (and 3424) OLD CAPITOL TRL, Wilmington DE 19808 (subdivision Minker Subd / Cranston Heights), owner "804 PARTNERS, C/O 804 LLC, 3422 Old Capitol Tr" - so the dot is on the right lot for the registry's addres  
  refuter upheld  
  https://gis.nccde.org/agsserver/rest/services/CustomMaps/Ownership/MapServer/0/query?geometry=-75.627882,39.730981&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=false&f=json; https://enterprise.firstmap.delaware.gov/arcgis/rest/services/PlanningCadastre/DE_StateParcels/FeatureServer/0/query?where=PIN%3D%270703740118%27&outFields=*&f=geojson&outSR=4326; https://www.peeringdb.com/api/fac?name__contains=USNAMES&depth=0

## Kept, but look — the owner is not obviously the project, or the two agents disagreed

- **site-e427887c01** AiNET WDC11 (AiNET) — Prince George's County, MD  
  parcel: owner not published · 0.457 ac · ref 17101008960 · md  
  **wrong** / review · owner is unrelated · high — The parcel record the pipeline attached (MD acct 17101008960 = PG Co. district 10 acct 1008960) is NOT the data centre's lot. Prince George's County's own Property_Flattened layer gives its owner as "C & P TEL CO OF BALTO CITY" (Chesapeake & Potomac Telephone, i.e. Verizon Maryland), c/o "ASST MGR STATE & LOCAL TAXES, 1 E PRATT ST RM 8N20, BALTIMOR  
  refuter upheld  
  https://gis.princegeorgescountymd.gov/arcgis/rest/services/Property/Property_Flattened/MapServer/0/query?where=ACCOUNT%20IN%20('1008960','1098813')&outFields=ACCOUNT,OWNER_NAME,ICO_NAME,MAIL_STREET,MAIL_CITY,HOUSE_NUMBER,STREET_NAME,STREET_TYPE,LAND_AREA_ACRE,PROPERTY_DESC,STRUCTURE_SQ_FT,YEAR_BUILT,SALES_PRICE,TRANSFER_DATE,EXEMPT_CLASS,CONFLICTS,UNIQUE_ID&returnGeometry=false&f=json; https://gis.princegeorgescountymd.gov/arcgis/rest/services/Property/Property_Flattened/MapServer/0/query?where=ACCOUNT%3D'1098813'&outFields=*&returnGeometry=true&outSR=4326&f=json; https://gis.princegeorgescountymd.gov/arcgis/rest/services/Property/Property_Flattened/MapServer/0/query?geometry=-76.847997,39.101379&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=ACCOUNT,OWNER_NAME,HOUSE_NUMBER,STREET_NAME&returnGeometry=false&f=json
- **site-e270ee9298** Equinix MI3 - Miami, Boca Raton (Equinix, Inc.) — Palm Beach County, FL  
  parcel: owner not published · ? ac · ref 06424712150000020 · fl  
  **part** / review · owner is landlord · high — The queried ref 06-42-47-12-15-000-0020 is "BOCA RATON INNOVATION CAMPUS LAND CONDO UNIT 2" - the land-condominium ground of the Boca Raton Innovation Campus (BRiC, the former IBM campus at 5000 T-Rex Ave). The number is retired on the current Palm Beach roll: on 01/03/2025 Unit 2 was split into 2A (-0021, 74.77 ac) and 2B (-0022, 3.43 ac), both ow  
  https://pbcpao.gov/Property/Details?parcelId=06424712150000021; https://pbcpao.gov/Property/Details?parcelId=06424712150000022; https://pbcpao.gov/Property/Details?parcelId=06424712150000010
- **site-0d53aa8ade** Lagrange CO (Ligtel Communications, Inc.) — LaGrange County, IN  
  parcel: owner not published · ? ac · ref 440625200000013018 · in  
  **part** / review · owner is landlord · medium — Parcel 44-06-25-200-000.013-018 (state id 440625200000013018) is a 0.35-acre lot with situs "W CENTRAL AVE" (no house number), DLGF class 400, in LaGrange civil town, Clay Twp; the Precisely parcel record for the site gives the same parcel at 0.37 ac. The LaGrange County treasurer's roll (PayGov) records the owner as "Six & Thirty-Three, LLC", whic  
  https://pay.paygov.us/EndUser/ParcelSearch.aspx?ttid=10838; https://gisdata.in.gov/server/rest/services/Hosted/Parcel_Boundaries_of_Indiana_Current/FeatureServer/0/query?where=state_parcel_id%20IN%20('440625200000012018','440625200000013018','440625200000019018')&outFields=*&returnGeometry=true&outSR=4326&f=json; https://gisdata.in.gov/server/rest/services/Hosted/Parcel_Boundaries_of_Indiana_Current/FeatureServer/0/query?geometry=-85.4280,41.6395,-85.4250,41.6425&geometryType=esriGeometryEnvelope&inSR=4326&outFields=parcel_id,prop_add,latitude,longitude&f=json
- **site-2f8e8e1abf** VentureData () — Madison County, ID  
  parcel: owner not published · ? ac · ref RPR0000038001A · id  
  **campus** / review · owner is landlord · high — The parcel is the lot under the mapped building, so the boundary is right; the doubt is about the site itself. The registry row is a single OSM building (way 290101976) at 19 College Avenue, Rexburg, tagged name/brand "VentureData", telecom=data_center. Madison County's own live parcel service (madison.rexburg.org/mrgis, via the assessor's GIS port  
  https://madison.rexburg.org/mrgis/rest/services/Data/Parcels/MapServer/0/query?geometry=-111.78207,43.825229&geometryType=esriGeometryPoint&inSR=4326&outFields=*&f=json; https://www.madisoncountyid.gov/departments/assessor/index.php; https://gis.idwr.idaho.gov/hosting/rest/services/Reference/Parcels/FeatureServer/0/query?where=PIN='RPR0000038001A'&outFields=*&f=json

## Kept — the parcel reads as the project's own ground

- **site-4f55e97e99** Arconic Massena Data Center (Arconic (Apollo Global Management)) — St. Lawrence County, NY  
  parcel: Arconic US LLC · 1157.47766768 ac · ref 9.002-3-3.11 · ny · +30 same-owner lot(s)  
  **campus** / keep · owner is operator · high — The seed parcel 9.002-3-3.11 is Arconic's Massena Operations plant itself. The NYS Tax Parcels Public service (the layer the pipeline queried) returns it at the site coordinate with PRIMARY_OWNER 'Arconic US LLC', situs '45 Cr 42 & 1814 Sh 131,85,205 Whe', property class 710 (manufacturing), 1157.5 calc / 1170.5 roll acres, mail address 201 Isabell  
  refuter upheld  
  https://gisservices.its.ny.gov/arcgis/rest/services/NYS_Tax_Parcels_Public/FeatureServer/1/query?geometry=%7B%22x%22%3A-74.8875%2C%22y%22%3A44.9524%7D&geometryType=esriGeometryPoint&inSR=4326&outFields=*&f=json; https://www.nny360.com/news/stlawrencecounty/data-centers-descend-on-needy-upstate-ny-towns-is-anyone-looking-out-for-us/article_93198557-09ad-545e-9420-cb9e3036cac3.html; https://www.interconnection.fyi/project/nyiso-1730
- **site-42a1b86a6e** Google Fort Wayne (Google) — Allen County, IN  
  parcel: owner not published · ? ac · ref 021327100001000077 · in  
  **campus** / keep · owner is spv · high — The Allen County property record card for parcel 02-13-27-100-001.000-077 (the pipeline's ref 021327100001000077) shows the recorded owner as Hatchworks LLC with mailing address "Attn: Tax Department, 1600 Amphitheatre Pkwy, Mountain View, CA 94043" - Google's headquarters - and Hatchworks LLC is reported by local press and IDEM permit coverage as   
  refuter upheld  
  https://www.acimap.us/website/prc/021327100001000077.pdf; https://www.acimap.us/website/prc/021327100001000077.pdf; https://www.acimap.us/website/prc/021327451001000077.pdf
- **site-9f5976f614** Holtec HI-CLOUD Indian Point (Holtec International) — Westchester County, NY  
  parcel: Entergy Nuclear Indian Pt · 25.18126358 ac · ref 43.10-2-3 · ny · +4 same-owner lot(s)  
  **campus** / keep · owner is spv · high — Parcel 43.10-2-3 (Village of Buchanan, Town of Cortlandt) is the 25.18-acre southern-tip lot of the Indian Point Energy Center. On the 2025 NYS tax roll it is owner 'Entergy Nuclear Indian Pt', situs 'Broadway' 10511, property class 464 (office building), roll section 8 (wholly exempt), with tax mail addressed to '1 Holtec Blvd' (Holtec's Camden HQ  
  refuter upheld  
  https://gisservices.its.ny.gov/arcgis/rest/services/NYS_Tax_Parcels_Public/MapServer/1/query; https://peekskillherald.com/21026/environment/holtec-tells-decommissioning-board-it-wants-to-bring-data-center-to-indian-point/; https://extapps.dec.ny.gov/docs/materials_minerals_pdf/indianpointriswp.pdf
- **site-9c0312d00c** Kenwood Tech Center (EKG Group / Guild Ventures) — Albany County, NY  
  parcel: Guild Ventures LLC F/K/A · 75.55913437 ac · ref 87.10-1-2.1 · ny  
  **campus** / keep · owner is operator · high — The queried parcel 87.10-1-2.1 (City of Albany, 75.56 ac, owner "Guild Ventures LLC F/K/A ...") is the former Kenwood Convent / Doane Stuart campus itself. Guild Ventures LLC is the recorded owner of that property: it bought the mortgage, foreclosed and took title at a March 2023 auction (Guild Ventures, LLC v Kenwood Commons, LLC, 2026 NY Slip Op   
  refuter upheld  
  https://www.nycourts.gov/reporter/current/3dseries/2026/2026_03854.shtml; https://www.yahoo.com/news/us/articles/data-center-planned-former-kenwood-214202581.html; https://www.wamc.org/news/2026-08-06/kenwood-data-center-albany-community-meeting
- **site-ce1dbeb705** NCCS Massena (North Country Colocation Services (NYDIG)) — St. Lawrence County, NY  
  parcel: Reynolds Metals Company · 1375.63364191 ac · ref 6.003-1-1.111 · ny  
  **campus** / keep · owner is landlord · high — Parcel 6.003-1-1.111 (Town of Massena, SWIS 405889) is the entire former Reynolds Metals / Alcoa "Massena East" smelter site. The NYS Tax Parcels service (roll year 2025) records its situs as "182, 194 Cr 45", which is exactly the registry's "182-194 County Road 45" and NCCS's registered corporate address (194 County Road 45, Massena NY 13662). It   
  refuter upheld  
  https://gisservices.its.ny.gov/arcgis/rest/services/NYS_Tax_Parcels_Public/MapServer/1/query; https://www.nccs.one/massena; https://opendatany.com/corporation.php?id=5318496
- **site-cb6283f416** Pontoon Bridge Road Data Center (American Data Center Partners LLC) — St. Lawrence County, NY  
  parcel: Air Products and Chemicals Inc · 69.52261381 ac · ref 4.004-1-19.1 · ny · +1 same-owner lot(s)  
  **campus** / keep · owner is seller · high — The queried parcel 4.004-1-19.1 (Town of Massena, SWIS 405889) carries the situs address "466 Pontoon Bridge Rd" in the NYS Tax Parcels layer, an exact match to the registry address for the project; the parcel is 69.4 deeded / 69.5 calc acres, class 321 vacant land. The dossier's owner "Air Products and Chemicals Inc" (mail 1940 Air Products Blvd,   
  refuter upheld  
  https://gisservices.its.ny.gov/arcgis/rest/services/NYS_Tax_Parcels_Public/FeatureServer/1/query?geometry=-74.911,44.959&geometryType=esriGeometryPoint&inSR=4326&outFields=*&f=json; https://maps.dancgis.org/server/rest/services/Parcel_Model/MapServer/0/query?geometry=-74.911,44.959&geometryType=esriGeometryPoint&inSR=4326&outFields=*&f=json; https://maps.dancgis.org/server/rest/services/Parcel_Model/MapServer/0/query?where=SWIS%3D%27405889%27+AND+PRINT_KEY+IN+(%274.004-1-18%27,%274.004-1-19.1%27)&outFields=*&f=json
- **site-dfc74ea9b2** Ranalli SuperDC (Ranalli Super DC LLC) — Onondaga County, NY  
  parcel: Ranalli Super DC LLC · 27.07099185 ac · ref 055.-01-18.0 · ny · +2 same-owner lot(s)  
  **part** / keep · owner is operator · high — The hit parcel 055.-01-18.0 (27.07 ac) and both grown lots 055.-01-19.1 (95.82 ac) and 055.-01-20.0 (1.57 ac) are all on the roll to "Ranalli Super DC LLC", the same entity the registry names as operator. An official Onondaga County IDA public-hearing notice (Aug 2021, hosted by the Town of Lysander) lists exactly these three tax map numbers as one  
  refuter upheld  
  https://legacy.townoflysander.org/sites/default/files/Ranalli%20Super%20DC%20LLC%20PH%20notice.pdf; https://cnycentral.com/news/local/lysander-residents-challenge-potential-data-center-as-site-is-listed-for-60m; https://www.eaglenewsonline.com/baldwinsville_messenger/possible-massive-data-center-in-lysander-faces-community-opposition-town-attorney-to-draft-moratorium/article_635b1885-9f97-4747-bdf4-604d468fc641.html
- **site-d5381827c7** Riverview Innovation & Technology Campus (Riverview Innovation & Technology Campus Inc.) — Erie County, NY  
  parcel: Riverview Innovation & · 102.42577152 ac · ref 64.08-1-10 · ny  
  **part** / keep · owner is operator · high — The official NYS Tax Parcels Public service, point-queried at the site coordinate, returns exactly the dossier's parcel: print key 64.08-1-10, situs 3875 River Rd, Town of Tonawanda, Erie County, property class 710 (manufacturing), 102.42 ac, PRIMARY_OWNER 'Riverview Innovation &' with ADD_OWNER 'Technology Campus Inc' (the dossier's owner string i  
  refuter upheld  
  https://gisservices.its.ny.gov/arcgis/rest/services/NYS_Tax_Parcels_Public/MapServer/1/query?geometry=-78.9264,42.983&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=false&f=json; https://gisservices.its.ny.gov/arcgis/rest/services/NYS_Tax_Parcels_Public/MapServer/1/query?where=COUNTY_NAME%3D%27Erie%27+AND+PRIMARY_OWNER+LIKE+%27Riverview+Innovation%25%27&outFields=PARCEL_ADDR,PRINT_KEY,ACRES&returnGeometry=false&f=json; https://extapps.dec.ny.gov/data/DecDocs/C915353/Fact%20Sheet.BCP.C915353.2021-05-26.Newsletter04_Stack%20Demolition.pdf
- **site-733bb89680** TeraWulf Cayuga (Lake Hawkeye) (TeraWulf) — Tompkins County, NY  
  parcel: Cayuga Operating Co, LLC · 54.31178665 ac · ref 11.-1-3.211 · ny · +1 same-owner lot(s)  
  **part** / keep · owner is landlord · high — The point-queried parcel 11.-1-3.211 is the former Cayuga (Milliken Station) coal plant lot itself: NYS Tax Parcels gives owner Cayuga Operating Co, LLC, situs 228 Cayuga Dr, Lansing, property class 875 (electric generation), 54.31 ac; the site coordinate falls inside it (point-in-polygon check on the layer geometry), on its lakeshore edge where th  
  refuter upheld  
  https://gisservices.its.ny.gov/arcgis/rest/services/NYS_Tax_Parcels_Public/FeatureServer/1/query?where=COUNTY_NAME%3D%27Tompkins%27+AND+PRIMARY_OWNER+LIKE+%27Cayuga+Operating%25%27&outFields=PRINT_KEY,PRIMARY_OWNER,PARCEL_ADDR,PROP_CLASS,CALC_ACRES,MAIL_ADDR&f=json; https://www.lansingtownny.gov/sites/default/files/fileattachments/zoning_board_of_appeals/meeting/3846/12-22-25_zba_minutes.pdf; https://mccmeetings.blob.core.usgovcloudapi.net/lansingny-pubu/MEET-Packet-9ba6739d47ee4678934a4a95101322f5.pdf
- **site-8f74e99e7d**  (DirecTV) — Cochise County, AZ  
  parcel: DIRECTV INC · 4.9 ac · ref 12316017 · az-04003 · +1 same-owner lot(s)  
  **campus** / keep · owner is landlord · high — The site is the DirecTV Benson uplink/broadcast facility at 401 Direct Drive (county situs "401 W DIRECT WAY"), Benson, AZ: a 6,980 sq ft single-storey data center/uplink built 2006 on "just under 5 acres". Parcel 123-16-017 is exactly that: 4.900 AC by legal description, situs 401 W Direct Way, commercial use code 2590, FCV ~$1.2M, and my point-in  
  https://services6.arcgis.com/Yxem0VOcqSy8T6TE/ArcGIS/rest/services/Cad_Parcel_TaxInfo/FeatureServer/0/query?where=apn%20IN%20('12316017','12316002G')&outFields=*&returnGeometry=true&outSR=4326&f=json; https://parcelinquirytreasurer.cochise.az.gov/Parcel/TaxSummary?parcelnumber=1231601706; https://parcelinquirytreasurer.cochise.az.gov/Parcel/OwnerHistory
- **site-83404b830e**  (Verizon Wireless) — Hancock County, IN  
  parcel: owner not published · ? ac · ref 300926400016000012 · in  
  **campus** / keep · owner is operator · high — The site is OSM way 349925359, a 1,954 m2 building tagged operator=Verizon Wireless, telecom=data_center, addr 7510 West Stinemyer Road, New Palestine IN 46163. The queried parcel 30-09-26-400-016.000-012 (Hancock County, Sugar Creek Township) has the identical situs address per both the Indiana state parcel layer (prop_add "7510 W Stinemyer Rd", D  
  https://lowtaxinfo.com/hancockcounty/1088341-2026; https://gisdata.in.gov/server/rest/services/Hosted/Parcel_Boundaries_of_Indiana_Current/FeatureServer/0/query?where=state_parcel_id%3D%27300926400016000012%27&outFields=*&f=json; https://www.openstreetmap.org/api/0.6/way/349925359.json
- **site-a4a766bc5b**  () — Frederick County, MD  
  parcel: owner not published · 12.86 ac · ref 1128555660 · md  
  **campus** / keep · owner is landlord · high — The site is an OSM-only entry: way 178331621 (building=yes, telecom=data_center, ~5,956 m2) whose bbox (-77.4122..-77.4109, 39.3773..39.3783) contains the site coordinate and sits wholly inside the queried parcel (bbox -77.4131..-77.4097, 39.3760..39.3788). The MD iMAP parcel record for ACCTID 1128555660 (Frederick Co. district 28, account 555660)   
  https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_ParcelBoundaries/MapServer/0/query?where=ACCTID%3D%271128555660%27&outFields=*&returnGeometry=false&f=json; https://www.openstreetmap.org/api/0.6/way/178331621.json; https://www.hotfrog.com/company/1098508868100096
- **site-c227e4439b**  () — Howard County, MD  
  parcel: owner not published · 41.824 ac · ref 1406594006 · md  
  **campus** / keep · owner is landlord · high — The registry row is bare (no name/operator/address; source OSM way 1143804764, which is tagged telecom=data_center at 9800 South Eternal Rings Drive, Laurel MD 20723). The MD iMAP parcel record for ACCTID 1406594006 (Howard County acct 06-594006) is that exact address: legal "PAR A-2 41.824 A., EMERSON SEC 3 AR 7", 41.824 ac, commercial, one 110,33  
  https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_ParcelBoundaries/MapServer/0/query?where=ACCTID%3D%271406594006%27&outFields=*&returnGeometry=false&f=json; https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_ParcelBoundaries/MapServer/0/query?geometry=-76.851434,39.133687&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=ACCTID,ADDRESS,ACRES&returnGeometry=false&f=json; https://data.howardcountymd.gov/ScannedPDF/WP/WP-21-096.pdf
- **site-3d442303c9** ARE-ON Forrest City (Arkansas Research and Education Optical Network (AREON)) — St. Francis County, AR  
  parcel: BOARD OF TRUSTEES OF THE UNIVERSITY OF ARKANSAS · 39.68000031 ac · ref 0800-00658-0000 · ar  
  **part** / keep · owner is landlord · medium — The site is the ARE-ON Forrest City PoP (PeeringDB fac 1670, '1802 New Castle Road', Forrest City AR 72335; the registry coordinate 35.040103/-90.768064 is PeeringDB's own). AREON is the state higher-education consortium 'supported administratively by the University of Arkansas System'; its PoPs sit at member institutions. The parcel returned by th  
  https://www.peeringdb.com/fac/1670; https://gis.arkansas.gov/arcgis/rest/services/FEATURESERVICES/Planning_Cadastre/FeatureServer/6; https://encyclopediaofarkansas.net/entries/east-arkansas-community-college-5181/
- **site-4d022fc8d5** AiNET (AiNET Corporation) — Prince George's County, MD  
  parcel: owner not published · 4.49 ac · ref 17010003913 · md  
  **campus** / keep · owner is operator · high — The queried parcel (MD ACCTID 17010003913, PG County district 01 acct 0003913, 4.49 ac) has situs address 11700 MONTGOMERY RD, BELTSVILLE MD 20705, which is exactly AiNET's published data-center address (PeeringDB fac 4069 'AINET - Beltsville', 11700 Montgomery Rd, coords 39.052767/-76.925864, ~10 m from the site point). The state layer strips owne  
  https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_ParcelBoundaries/MapServer/0/query?geometry=-76.925925,39.05284&geometryType=esriGeometryPoint&inSR=4326&outFields=*&f=json; https://www.peeringdb.com/fac/4069; https://baxtel.com/data-center/ainet-beltsville-wdc-1
- **site-ed43af40a2** AiNET One Market Center (AiNET) — Baltimore city, MD  
  parcel: owner not published · 9.126 ac · ref 0304100596 002 · md  
  **campus** / keep · owner is spv · high — The polygon (MD statewide layer POLYID 03-0000000121296, POLYACRES 1.499) is the lot under One Market Center, 300 W Lexington St: bbox -76.62097..-76.61972 / 39.29161..39.29223, the southern part of Baltimore City block 0596 (Eutaw St west, Howard St east, Lexington St south), directly beside the Lexington Market Metro station lot (0596 001, Mass T  
  https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_ParcelBoundaries/MapServer/0/query?where=ACCTID%3D%270304100596%20002%27&outFields=ACCTID,ADDRESS,STRTUNT,LEGAL1,DESCEXCL,ACRES,LANDAREA,POLYACRES,POLYID&returnGeometry=true&outSR=4326&f=json; https://geodata.baltimorecity.gov/egis/rest/services/CityView/Realproperty_OB/MapServer/0/query?where=BLOCKLOT%20IN%20(%270596%20034%27,%270596%20002%27)&outFields=BLOCKLOT,FULLADDR,OWNER_1,OWNER_2,MAILTOADD,PROPDESC,LOT_SIZE,OWNMDE,DEEDBOOK,DEEDPAGE,SALEDATE,SALEPRIC,YEAR_BUILD,PINRELATE&returnGeometry=true&outSR=4326&f=json; https://www.ai.net/carrierhotel/
- **site-2bb4b18bb0** AlasConnect Data Center 1 (AlasConnect) — Fairbanks North Star Borough, AK  
  parcel: GOLDEN VALLEY ELECT ASSN INC · ? ac · ref 596716 · ak · +4 same-owner lot(s)  
  **campus** / keep · owner is landlord · high — The queried parcel (FNSB PAN 0596716, "LOT 1-A US SURVEY 806", 72,875.88 sq ft = 1.67 ac, zoned HI) has situs "612 ILLINOIS ST", which is exactly the address PeeringDB, datacentermap and alasconnect.com give for AlasConnect Data Center 1 / the AlasConnect Fairbanks office. The borough assessor's record lists the parcel's Business as "ALASCONNECT" a  
  https://propertysearch.fnsb.gov/property/596716; https://www.peeringdb.com/fac/8021; https://alasconnect.com/about/fairbanks/
- **site-bcfc301f48** AlasConnect Data Center 5 (AlasConnect) — Anchorage Municipality, AK  
  parcel: TLC PROPERTIES LLC · ? ac · ref 01010342000 · ak · +4 same-owner lot(s)  
  **campus** / keep · owner is landlord · high — Parcel 01010342000 is exactly the lot the registry address sits on. The Municipality of Anchorage assessor record (PropertyInformation_Hosted feature service and the property.muni.org datalet) gives situs "3403 MINNESOTA DR", legal "RYAN LT 19B", land use "Office Bldg - low rise 1-4 lvls", year built 1981, 29,961 sq ft (0.69 ac), zoning B3, owner T  
  https://services2.arcgis.com/Ce3DhLRthdwbHlfF/arcgis/rest/services/PropertyInformation_Hosted/FeatureServer/0/query?where=Parcel_ID='01010342000'&outFields=*&f=json; https://property.muni.org/Datalets/Datalet.aspx?UseSearch=no&pin=01010342000; https://www.peeringdb.com/api/fac/8025
- **site-ec3dc94a1d** AlohaNAP Datacenter (AlohaNAP) — Honolulu County, HI  
  parcel: owner not published · 20.38758946 ac · ref 192043005 · hi  
  **campus** / keep · owner is landlord · high — Parcel 192043005 is Honolulu TMK 1-9-2-043-005, a 20.42-acre improved lot (land $5.69M, building $1.75M) at Farrington Hwy, Kapolei. The dossier had no owner; the City & County of Honolulu ownership table gives two parties for tax year 2024: fee owner FORT STREET INVESTMENT CORP (mailing address James Campbell Building, 1001 Kamokila Blvd Ste 256,   
  https://services.arcgis.com/tNJpAOha4mODLkXz/arcgis/rest/services/PropertyReportInfo/FeatureServer/2/query?where=tmk%3D%2792043005%27&outFields=*&returnGeometry=false&f=pjson; https://www.peeringdb.com/fac/3149; https://geodata.hawaii.gov/arcgis/rest/services/ParcelsZoning/MapServer/11/query?geometry=-158.090266,21.336755&geometryType=esriGeometryPoint&inSR=4326&outFields=*&f=pjson
- **site-6c0b239a90** Atlantech Online - Silver Spring, MD (Atlantech Online, Inc.) — Montgomery County, MD  
  parcel: owner not published · 0.594 ac · ref 161302621237 · md  
  **campus** / keep · owner is landlord · high — Parcel 161302621237 (Montgomery Co. district 13, account 02621237) is the lot under the 13-storey, 207,746 sq ft 'Station Square' office tower at 1010 Wayne Ave, Silver Spring 20910 (built 1987, land 25,892 sq ft = 0.594 ac, exactly the dossier's acreage; legal description 'Silver Spring Lees Add', lot 10 block 1B). A spatial query of the county pa  
  https://gis3.montgomerycountymd.gov/arcgis/rest/services/property/property_query/MapServer/0/query?where=ACCT%20LIKE%20%27%2502621237%27&outFields=*&returnGeometry=false&f=json; https://gis3.montgomerycountymd.gov/arcgis/rest/services/property/property_query/MapServer/0/query?geometry=-77.027705,38.993843&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=ACCT,PREMISE_ADDR_HOUSENO,PREMISE_ADDR_STREET&returnGeometry=false&f=json; https://apps.montgomerycountymd.gov/realpropertytax/SearchParcel.aspx?ParcelCode=02621237
- **site-ceead38cb9** Baltimore Technology Park (TierPoint, LLC) — Baltimore city, MD  
  parcel: owner not published · 0.888 ac · ref 0321090839 002 · md  
  **campus** / keep · owner is operator · high — The MD iMAP parcel returned at the coordinate (ACCTID 0321090839 002, Baltimore City Ward 21 / Section 09 / Block 0839 / Lot 002) has premises address 1401 RUSSELL ST, Baltimore MD 21230, which is exactly the address TierPoint publishes for its Baltimore data center. Baltimore City's own Realproperty_OB GIS layer (point-queried at the same coordina  
  https://www.tierpoint.com/data-centers/maryland/baltimore/; https://www.tierpoint.com/contact/; https://geodata.baltimorecity.gov/egis/rest/services/CityView/Realproperty_OB/MapServer/0/query (point -76.62551,39.275367)
- **site-4d1732e5fd** Centersquare Atlanta ATL1 (Centersquare) — Douglas County, GA  
  parcel: owner not published · 31.99 ac · ref 09431820001 · ga-13097-arc-mrpa  
  **campus** / keep · owner is landlord · high — The parcel (Douglas County PIN 09431820001, 31.99 ac, legal description "BLDG/31.993 ACRES, RIVERSIDE PARKWAY", zoned LI-R, industrial class I5) has situs 375 Riverside Pkwy, Lithia Springs GA 30122 in both the ARC MRPA layer and the county's own parcel/land-records layers, and the site coordinate falls inside its geometry (checked point-in-polygon  
  https://www.csquare.com/hubfs/Centersquare%20website/docs/Csquare-ATL-SpecSheet.pdf; https://csquare.com/data-centers/atlanta; https://services1.arcgis.com/Ug5xGQbHsD8zuZzM/arcgis/rest/services/MRPA_Corridor_County_Parcels/FeatureServer/7/query?where=PIN%3D%2709431820001%27&outFields=*&f=json
- **site-23d44d85bc** Cloudpath CT2 (1351 Washington Blvd) (Cloudpath LLC) — Western Connecticut Planning Region, CT  
  parcel: 80 WEP-1351 LLC 50% ET AL · 2 ac · ref E 061 9168 · ct · +1 same-owner lot(s)  
  **campus** / keep · owner is landlord · high — The point-queried parcel E 061 9168 is the lot of the 1351 Washington Boulevard office building in Stamford, which is exactly the address Cloudpath LLC registered for 'Cloudpath CT2' in PeeringDB (fac 10444, coordinate 41.058085/-73.542936 identical to the registry's). The CT statewide CAMA layer gives Location_1 '1351 WASHINGTON BOULEVARD' for thi  
  https://www.peeringdb.com/api/fac/10444; https://gis.vgsi.com/stamfordct/Parcel.aspx?pid=8829; https://services3.arcgis.com/3FL1kr7L4LvwA2Kb/arcgis/rest/services/Connecticut_CAMA_and_Parcel_Layer/FeatureServer/0/query
- **site-57b8f5b684** Cogent Elkridge (Cogent Communications, Inc.) — Howard County, MD  
  parcel: owner not published · 5.1 ac · ref 1401164058 · md  
  **campus** / keep · owner is operator · high — Parcel 1401164058 (Howard County acct 01-164058) is the whole lot under Cogent's Baltimore-market data centre. SDAT shows the recorded owner as "US SPRINT COMMUNICATIONS COMPANY LIMITED PARTNERSHIP" (mailing PO Box 12913, Shawnee Mission KS), legal "PAR A 5.10 A / RACE RD / U S TELECOM", premises "W RACE RD, HANOVER 21076" (no house number on the r  
  https://sdat.dat.maryland.gov/RealProperty/Pages/viewdetails.aspx?County=14&SearchType=ACCT&District=01&AccountNumber=164058; https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_ParcelBoundaries/MapServer/0/query?where=ACCTID%3D%271401164058%27&outFields=*&f=json; https://www.peeringdb.com/api/fac/16446
- **site-51882465cb** Cogent New Orleans (Cogent Communications, Inc.) — Orleans Parish, LA  
  parcel: owner not published · 0.79772059 ac · ref 41032940 · la-22071  
  **campus** / keep · owner is landlord · high — The pipeline's parcel (GEOPIN 41032940, 0.798 ac, 12 vertices) was re-queried directly on the City of New Orleans / Orleans Parish Assessor parcel layer both by GEOPIN and by the site point; both return the same feature. The city's Property Information layer (apps/property3, same assessor data with owner fields) at the site coordinate gives PARCELI  
  https://gis.nola.gov/arcgis/rest/services/apps/property3/MapServer/15/query?geometry=-90.070115,29.948875&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=false&f=pjson; https://gis.nola.gov/arcgis/rest/services/LandBase/Parcels/MapServer/0/query?where=GEOPIN%3D%2741032940%27&outFields=*&returnGeometry=true&outSR=4326&f=pjson; https://cogentco.com/en/cogent-new-orleans
- **site-124c3a220e** Cologix Jacksonville JAX1 (SBA Edge - Jacksonville (JAX)) — Duval County, FL  
  parcel: SBA EDGE JAX LLC · ? ac · ref 0738420000R · fl · +1 same-owner lot(s)  
  **campus** / keep · owner is operator · high — Duval County Property Appraiser record for RE 073842-0000 shows owner SBA EDGE JAX LLC, situs 421 W Church St, Jacksonville FL 32202, 0.756 ac, 8-storey building built 1959, bought 7/31/2020 for $24.9M by special warranty deed; mailing address 8051 Congress Ave, Boca Raton (SBA Communications' HQ). PeeringDB lists the facility "SBA Edge - Jacksonvi  
  https://paopropertysearch.coj.net/Basic/Detail.aspx?RE=0738420000; https://paopropertysearch.coj.net/Basic/Detail.aspx?RE=0738450000; https://www.peeringdb.com/api/fac?name__contains=SBA%20Edge&city=Jacksonville
- **site-4316d990eb** Crown Castle Baltimore (Crown Castle Fiber) — Baltimore city, MD  
  parcel: owner not published · 1.302 ac · ref 0304111385 001 · md  
  **campus** / keep · owner is landlord · high — The MD iMAP parcel ACCTID "0304111385 001" is Baltimore City Ward 04 / Section 11 / Block 1385 / Lot 001, premises 115 Market Pl, Baltimore 21202: a 1.302-acre full city block carrying a 12-storey, 552,052 sq ft office building built 1912, zoned C-5DC, Inner Harbor neighbourhood, last conveyed 2017-02-03 for $60.1M (deed MB 18855/0242). The state l  
  https://geodata.baltimorecity.gov/egis/rest/services/CityView/Realproperty_OB/MapServer/0/query?geometry=-76.606489,39.287702&geometryType=esriGeometryPoint&inSR=4326&outFields=*&f=json; https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_ParcelBoundaries/MapServer/0/query?where=ACCTID%3D%270304111385%20001%27&outFields=*&f=json; https://www.peeringdb.com/api/fac/7273
- **site-87d6c05d96** Crown Castle Stamford (Crown Castle Inc.) — Western Connecticut Planning Region, CT  
  parcel: 80 WEP-1351 LLC 50% ET AL · 2 ac · ref E 061 9168 · ct · +1 same-owner lot(s)  
  **campus** / keep · owner is landlord · high — The queried parcel (CT CAMA link E 061 9168, Stamford) has situs address 1351 WASHINGTON BOULEVARD, Stamford 06902, which is exactly the registry's source address and the PeeringDB facility address for 'Crown Castle Stamford' (fac 13697, org Crown Castle Inc., lat 41.058085 / lon -73.542936, identical to the registry coordinate). So the dot is not   
  https://services3.arcgis.com/3FL1kr7L4LvwA2Kb/arcgis/rest/services/Connecticut_CAMA_and_Parcel_Layer/FeatureServer/0/query?geometry=-73.542936,41.058085&geometryType=esriGeometryPoint&inSR=4326&outFields=*&f=json; https://www.peeringdb.com/api/fac/13697; https://www.peeringdb.com/api/fac?city__contains=Stamford
- **site-2120ee9020** CyberNAP Glen Burnie (AiNET) — Anne Arundel County, MD  
  parcel: owner not published · 14.4 ac · ref 020300090053017 · md  
  **campus** / keep · owner is spv · high — The dossier had no owner, so I re-ran the point query myself against Anne Arundel County's own parcel service (OpenData/Planning_OpenData layer 34) at 39.14023, -76.60643. It returns exactly one parcel, account 300090053017 (= the dossier ref 020300090053017 with the state's 02 county prefix): situs 7900 RITCHIE HWY, GLEN BURNIE 21061, legal descri  
  https://gis.aacounty.org/arcgis/rest/services/OpenData/Planning_OpenData/MapServer/34/query?geometry=-76.60643,39.14023&geometryType=esriGeometryPoint&inSR=4326&outFields=*&returnGeometry=false&f=json; https://www.peeringdb.com/api/org?name__contains=AiNET; https://www.peeringdb.com/fac/6539
- **site-1bab733314** Cyxtera Tampa TP1 (Cyxtera) — Hillsborough County, FL  
  parcel: EASTGROUP FLORIDA HOLDINGS INC · ? ac · ref 202919ZZZ000002518700U · fl · +2 same-owner lot(s)  
  **campus** / keep · owner is landlord · high — The queried parcel (HCPA folio 068042-0230, pin 202919ZZZ000002518700U) is the lot under the Cyxtera/Centersquare Tampa TP1 hall. Its situs is 9302 Florida Palm Rd, Tampa; the data centre's published address is 9310 Florida Palm Drive, Tampa 33619 (PeeringDB fac 2655, Baxtel), and an HCPA address search shows only four parcels on Florida Palm (9202  
  https://gis.hcpafl.org/propertysearch/#/parcel/basic/202919ZZZ000002518700U; https://gis.hcpafl.org/CommonServices/property/search/BasicSearch?address=FLORIDA%20PALM; https://www.peeringdb.com/fac/2655
- **site-5a358f5dab** DRFortress HNL (DRFortress LLC) — Honolulu County, HI  
  parcel: owner not published · 12.50118033 ac · ref 111015013 · hi  
  **campus** / keep · owner is landlord · high — The point-queried parcel is TMK (1)1-1-015:013 (Honolulu RPAD key 110150130000), a 546,210 sq ft / 12.54-acre condo-master parcel named "AIRPORT CENTER" (a.k.a. Airport Industrial Park) with situs addresses 3365/3375 Koapaka St and 530 Paiea St. The Honolulu Real Property Assessment record for the condo unit 110150130001 at 3375 KOAPAKA ST lists th  
  https://qpublic.schneidercorp.com/Application.aspx?AppID=1045&PageTypeID=4&KeyValue=110150130001; https://qpublic.schneidercorp.com/Application.aspx?AppID=1045&PageTypeID=4&KeyValue=110150130000; https://geodata.hawaii.gov/arcgis/rest/services/ParcelsZoning/MapServer/11/query?geometry=-157.917855,21.335678&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&f=pjson&returnGeometry=false
- **site-a2e2c87dbf** DartPoints Shreveport, LA - SHV1 (DartPoints, LLC) — Caddo Parish, LA  
  parcel: owner not published · 0.3444 a ac · ref 181437118002800 · la-22017  
  **campus** / keep · owner is operator · high — The NLCOG/Caddo Assessor parcel layer carries no owner field, so the dossier's blank owner is a layer limitation, not a red flag. The Caddo Parish Assessor's public roll (actDataScout, roll dated 11/19/2025) shows geog no. 181437-118-0028-00 (RPID 154954) owned by VENYU SOLUTIONS, L.L.C., business name "SELBER PROPERTIES-VACANT", situs 601 MILAM ST  
  https://www.actdatascout.com/RealProperty/Louisiana/Caddo; https://www.actdatascout.com/RealProperty/Louisiana/Caddo; https://www.peeringdb.com/api/fac?city__contains=Shreveport
- **site-b2087aaafb** Digital Crossroad (Digital Crossroad) — Lake County, IN  
  parcel: owner not published · ? ac · ref 450136176005000023 · in  
  **part** / keep · owner is landlord · high — The queried parcel 45-01-36-176-005.000-023 is the lot under Digital Crossroad's Phase 1 data hall. Lake County assessor (XSoft Engage) record: situs 100 DIGITAL CROSSROADS DR, Hammond IN 46320; legal description "PT NW1/4 S.36 T.38 R.10 LY'G NE'LY OF RR ( Lease Area) 3.908 Ac"; class 399 Other Industrial Structure; improvement "C/I Building, grade  
  https://engage.xsoftinc.com/lake/map/getparceldetail?parcelId=450136176005000023; https://engage.xsoftinc.com/lake/search/maprealproperty?src=dataonly&filter=%5B%22Address%22%2C%22contains%22%2C%22Digital%20Crossroads%22%5D; https://engage.xsoftinc.com/lake/map/getparceldetail?parcelId=450136176004000023
- **site-17e09449c5** EdgeConneX New Orleans (EDCSLI01) (EdgeConneX Inc.) — St. Tammany Parish, LA  
  parcel: owner not published · 1.73 ac · ref 1231216104 · la-22103  
  **campus** / keep · owner is spv · high — The assessor layer (la-22103, St. Tammany Parish Assessor FeatureServer) carries no owner/situs fields, so I queried the parish assessor's legacy assessment database (propertysearch.stassessor.org) by assessment number 1231216104. The certified roll (2017 through 2021, every year identical) lists the owner as EDGECONNEX NEW ORLEANS HOLDINGS LLC, c/  
  http://propertysearch.stassessor.org/assessor22.php; https://services5.arcgis.com/Ph2T7y7nG3DrfrQ1/arcgis/rest/services/parcel_polygons_v2025/FeatureServer/0/query?geometry=-89.737403,30.287098&geometryType=esriGeometryPoint&inSR=4326&outFields=*&f=json; https://www.peeringdb.com/api/fac?name__contains=EDCSLI01
- **site-daaaf24ff2** Endeavor Data Center (SystemMetrics) — Honolulu County, HI  
  parcel: owner not published · 3.11851874 ac · ref 112013020 · hi  
  **campus** / keep · owner is landlord · high — The Honolulu Real Property Assessment record for parcel 120130200000 (TMK 1-2-013-020, the pipeline's ref 112013020) gives its location address as 2339 KAMEHAMEHA HWY, exactly the registry/PeeringDB address of SystemMetrics' Endeavor Data Center. The parcel is 3.1203 acres (matches the dossier's 3.12 ac), class Industrial, improved with a 4-storey   
  https://qpublic.schneidercorp.com/Application.aspx?App=HonoluluCountyHI&PageType=Report&KeyValue=120130200000; https://www.peeringdb.com/api/fac?name__contains=Endeavor; https://www.datacentermap.com/usa/hawaii/honolulu/endeavor/
- **site-4451d6017c** Expedient Owings Mills (Expedient) — Baltimore County, MD  
  parcel: owner not published · 9.23 ac · ref 04042300006741 · md  
  **campus** / keep · owner is landlord · high — Parcel ACCTID 04042300006741 (Baltimore County district 04, account 2300006741; Tax Map 0057 Grid 0018 Parcel 0587, Lot 3A1 'Riparius Center at Owings Mills') has situs/premises address 11155 RED RUN BLVD, OWINGS MILLS MD 21117, 9.23 ac, a 4-storey 120,544 sq ft office building built 1999 (state MD_ParcelBoundaries and MD_PropertyData layers). Expe  
  https://www.expedient.com/data-centers/baltimore/; https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_ParcelBoundaries/MapServer/0/query?where=ACCTID%3D%2704042300006741%27&outFields=*&f=json; https://bcgis.baltimorecountymd.gov/arcgis/rest/services/Property/Property/MapServer/1/query?where=ST_NUM%3D11155+AND+STREETNAME+LIKE+%27RED+RUN%25%27&outFields=*&f=pjson
- **site-8c686d965a** Expedient Tidepoint (Expedient) — Baltimore city, MD  
  parcel: owner not published · 9.74 ac · ref 0324121976 001 · md  
  **campus** / keep · owner is landlord · high — The point-queried parcel (MD acct 0324121976 001 = Baltimore City Ward 24 Sec 12 Block 1976 Lot 001) is the Tide Point campus at 1000-1050 Hull St, Locust Point, 9.746 acres with a 406,569 sq ft 1929 building. Baltimore City's real-property layer records the owner as UA LOCUST POINT HOLDINGS, LLC (deed FMC13614/0216, sold 07/06/2011 for $58,000,000  
  https://geodata.baltimorecity.gov/egis/rest/services/CityView/Realproperty_OB/MapServer/0/query?geometry=-76.591671,39.274655&geometryType=esriGeometryPoint&inSR=4326&outFields=*&f=json; https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_ParcelBoundaries/MapServer/0/query?geometry=-76.591671,39.274655&geometryType=esriGeometryPoint&inSR=4326&outFields=*&f=json; https://web.archive.org/web/20260416045455/https://expedient.com/data-centers/baltimore/
- **site-e60c82cf87** FirstLight Data Center (FirstLight) — Cumberland County, ME  
  parcel: owner not published · ? ac · ref 05170_037 F009 · me  
  **campus** / keep · owner is landlord · high — The site coordinate (43.657839, -70.261379) is exactly OSM node 7171975407, an address point for "340 Cumberland Avenue, Unit 7, Portland ME 04101" that a mapper tagged in May 2021 as "FirstLight Data Center" (operator FirstLight, website firstlight.net/products/data-center/portland-me-data-center/). The Maine GeoLibrary parcel returned by the pipe  
  https://gis.portlandmaine.gov/maps/rest/services/planningCadastre/Tax_Parcels/FeatureServer/11/query?geometry=-70.261379,43.657839&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&f=json; https://services1.arcgis.com/RbMX0mRVOFNTdLzd/arcgis/rest/services/Maine_Parcels_Organized_Towns/FeatureServer/10/query?geometry=-70.261379,43.657839&geometryType=esriGeometryPoint&inSR=4326&outFields=*&f=json; https://api.openstreetmap.org/api/0.6/node/7171975407/history.json
- **site-d68550f285** FirstLight Regen Hut (NNENIX) — Cumberland County, ME  
  parcel: owner not published · ? ac · ref 05170_197 A003 · me  
  **campus** / keep · owner is landlord · high — The Maine GeoLibrary parcel polygon 05170_197 A003 (TOWN Portland, CBL 197-A-3) contains the site coordinate and carries PROP_LOC "00009 WESTLAND AVE", which is exactly the registry/PeeringDB address (9 Westland Avenue, Portland ME) for facility 3860 "FirstLight Regen Hut" (PeeringDB lat/lon 43.658074/-70.29982 is the same point; notes: "Long-haul   
  https://services1.arcgis.com/RbMX0mRVOFNTdLzd/arcgis/rest/services/Maine_Parcels_Organized_Towns/FeatureServer/10/query?geometry=-70.29982,43.658074&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&f=json; https://services1.arcgis.com/Z84SVYy1QoXoOXkk/arcgis/rest/services/parcel_list_assessor_10182023/FeatureServer/0/query?where=PARCEL_ID%20LIKE%20%27197%25A003%25%27&outFields=*&f=json; https://www.peeringdb.com/fac/3860
- **site-5fc84cd367** Hawaii Pacific Teleport (Hawaii Pacific Teleport LP) — Honolulu County, HI  
  parcel: owner not published · 20.38758946 ac · ref 192043005 · hi  
  **campus** / keep · owner is landlord · high — Parcel ref 192043005 is Oahu TMK (1) 9-2-043:005, recorded area 20.420 ac (GIS 20.39 ac), and the site coordinate point-queries to it on the state parcel service. The dossier's owner field was blank, so I pulled the City & County of Honolulu Real Property "Parcel Ownership" table (tax year 2024) directly: Fee Owner is FORT STREET INVESTMENT CORP, c  
  https://services.arcgis.com/tNJpAOha4mODLkXz/ArcGIS/rest/services/PropertyReportInfo/FeatureServer/2/query?where=tmk%3D%2792043005%27&outFields=*&returnGeometry=false&f=json; https://geodata.hawaii.gov/arcgis/rest/services/ParcelsZoning/MapServer/11/query?where=tmk9txt%3D%27192043005%27&outFields=*&returnGeometry=false&f=json; https://web.archive.org/web/2019/http://www.hawaiiteleport.com:80/index.php/contacts
- **site-abfeba9056** INdigital (INdigital Telecom) — Allen County, IN  
  parcel: owner not published · ? ac · ref 020717355012000073 · in  
  **campus** / keep · owner is spv · high — Allen County's own parcel service (gis1.acimap.us Parcel_Poly joined to CurrentOwner) point-queried at the site coordinate returns exactly the dossier's PIN 020717355012000073 (GIS_ID 02-07-17-355-012.000-073), situs '5312 W Washington Center Rd, Fort Wayne, IN 46818' — the PeeringDB facility address for INdigital and the address INdigital Telecom   
  https://gis1.acimap.us/imapweb/rest/services/QueryLayers/QueryLayers/MapServer/10/query?geometry=-85.211021,41.132672&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&f=json; https://gis1.acimap.us/imapweb/rest/services/QueryLayers/QueryLayers/MapServer/10/query?where=GISPublished.SDE.CurrentOwner.OwnerofRecord+LIKE+'Venture+Leasing%25'&outFields=*&returnGeometry=false&f=json; https://www.peeringdb.com/api/fac?name__contains=INdigital
- **site-7779132e8c** IPR Wilmington CCC (IPR International) — New Castle County, DE  
  parcel: owner not published · 1.25126391 ac · ref 2602840114 · de  
  **campus** / keep · owner is landlord · high — The registry coordinate (39.747859, -75.546753) is exactly PeeringDB's geocode for facility 1460 "IPR Wilmington CCC", 1201 N Market Street, Wilmington DE 19801 (record updated 2025-09-26; IPR International's org record and two IPR networks are registered at the same facility). The FirstMap state layer has no owner field, so I pulled the New Castle  
  https://www3.newcastlede.gov/parcel/Details/Default.aspx?ParcelKey=170396; https://www3.newcastlede.gov/parcel/Search/Default.aspx; https://www.peeringdb.com/api/fac?name=IPR%20Wilmington%20CCC&depth=0
- **site-e8d86c76f1** IU Data Center (Indiana University) — Monroe County, IN  
  parcel: owner not published · ? ac · ref 530534100001000005 · in  
  **campus** / keep · owner is operator · high — The dossier's owner/acreage fields were blank (the state IGIO layer carries no owner), so I queried Monroe County's own Parcels FeatureServer at the site point. It returns PIN 53-05-34-100-001.000-005 (FormattedPIN 530534100001000005, the same ref), owner "Indiana University, Trustees Of" (ATTN: Real Estate Department, Bloomington 47408), situs 270  
  https://gis.co.monroe.in.us/server/rest/services/Parcels/FeatureServer/0; https://lowtaxinfo.com/monroecounty?parcelNumber=53-05-34-100-001.000-005; https://gisdata.in.gov/server/rest/services/Hosted/Parcel_Boundaries_of_Indiana_Current/FeatureServer/0
- **site-86ae0bd9ef** IUPUI Informatics & Communications Technology Complex (Indiana University) — Marion County, IN  
  parcel: owner not published · ? ac · ref 491102220004000101 · in  
  **campus** / keep · owner is operator · high — The dossier's parcel record carried no owner or acreage, so I queried both the Indiana state parcel layer (the pipeline's 'in' layer) and the City of Indianapolis MapIndy 'Parcels w/ Owner Information' layer for state parcel 49-11-02-220-004.000-101. Recorded owner is "INDIANA UNIVERSITY TRS, ATTN REAL ESTATE DEPARTMENT" with owner address 2901 E D  
  https://gis.indy.gov/server/rest/services/MapIndy/MapIndyProperty/MapServer/10/query?where=STATEPARCELNUMBER%3D%2749-11-02-220-004.000-101%27&outFields=*&f=json; https://gisdata.in.gov/server/rest/services/Hosted/Parcel_Boundaries_of_Indiana_Current/FeatureServer/0/query?where=state_parcel_id%3D%27491102220004000101%27&outFields=*&f=json; https://www.peeringdb.com/api/fac?name__contains=IUPUI
- **site-f94c34136f** Johns Hopkins Data Center () — Baltimore city, MD  
  parcel: owner not published · 3.15 ac · ref 0326176333 030A · md  
  **campus** / keep · owner is operator · high — The dossier's parcel ref "0326176333 030A" is Baltimore City Ward 26 / Section 17 / Block 6333 / Lot 030A. Baltimore City's own real-property roll (dmxOwnership layer, data date 2026-09-06) gives it as 5400 E Lombard St, Baltimore 21224-1731, owner "JOHNS HOPKINS BAYVIEW MEDICAL CENTER, INC", 3.150 acres, fully exempt (code 82 = non-profit hospital  
  https://egisdata.baltimorecity.gov/egis/rest/services/Housing/dmxOwnership/MapServer/0/query?where=BLOCKLOT%3D%276333+030A%27&outFields=BLOCKLOT,OWNER_1,OWNER_2,FULLADDR,LOT_SIZE,USEGROUP,EXMPCODE,ZONECODE,DEEDBOOK,DEEDPAGE,SALEDATE,MAILTOADD,NEIGHBOR&returnGeometry=false&f=json; https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_ParcelBoundaries/MapServer/0/query?geometry=-76.551731,39.293559&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=ACCTID,ADDRESS,OWNADD1,DESCEXCL,DESCCIUSE,ACRES,ZONING,SDATWEBADR&returnGeometry=false&f=json; https://egisdata.baltimorecity.gov/egis/rest/services/Housing/DHCD_Open_Baltimore_Datasets/FeatureServer/3/query?where=CaseNumber%3D%27COM2025-00024%27&outFields=*&returnGeometry=false&f=json
- **site-6340cd6893** Lifeline Eastgate (Lifeline Data Centers) — Marion County, IN  
  parcel: owner not published · ? ac · ref 491001114016000770 · in  
  **part** / keep · owner is spv · high — The dossier's parcel 491001114016000770 (Marion County 49-10-01-114-016.000-770) came back with no owner/acreage because the Indiana state layer carries neither; the IndyGIS 'Parcels w/ Owner Information' layer fills it in: situs 401 N SHADELAND AVE, Indianapolis 46219 (exactly Lifeline's published Eastgate address), owner LIVE WIRE TECHNOLOGIES, L  
  https://gis.indy.gov/server/rest/services/MapIndy/MapIndyProperty/MapServer/10; https://gisdata.in.gov/server/rest/services/Hosted/Parcel_Boundaries_of_Indiana_Current/FeatureServer/0; https://lifelinedatacenters.com/locations/
- **site-2ea78fc986** Lifeline Ft Wayne (Lifeline Data Centers) — Allen County, IN  
  parcel: owner not published · ? ac · ref 021331102004000070 · in  
  **campus** / keep · owner is spv · high — The dossier's parcel (state key 021331102004000070 = Allen County PIN 02-13-31-102-004.000-070) had no owner or acreage attached, so I queried Allen County's own iMap ArcGIS parcel service (Parcel_Poly joined to CurrentOwner) at the site coordinate. It returns exactly this parcel: owner of record "Lifeline-7601 LLC", property address 7601 S Anthony  
  https://gis1.acimap.us/imapweb/rest/services/QueryLayers/QueryLayers/MapServer/10/query?geometry=-85.109976,41.014028&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=false&f=json; https://gis1.acimap.us/imapweb/rest/services/COMPS/Parcels_Sales_Live/MapServer/0/query?where=GISPublished.sde.AssessorSalesBuildingsParcelInfo.UnformattedStateKey%3D%27021331102004000070%27&outFields=*&returnGeometry=false&f=json; https://www.lifelinedatacenters.com/
- **site-a3cd52d8ed** Ligonier CO (Ligtel Communications, Inc.) — Noble County, IN  
  parcel: owner not published · ? ac · ref 570127400364000014 · in  
  **campus** / keep · owner is landlord · high — The parcel is the lot under LigTel's own headquarters/central-office building, not a neighbour. Noble County Beacon (auditor/assessor record for 57-01-27-400-364.000-014) gives the property address as 414 S Cavin St, Ligonier IN 46767, legal description "Op Lot 21", class Commercial Office Building 1-2 story, land 66 x 165 ft (~0.26 acre), a 10,616  
  https://beacon.schneidercorp.com/Application.aspx?AppID=127&LayerID=1479&PageTypeID=4&PageID=800&KeyValue=57-01-27-400-364.000-014; https://gisdata.in.gov/server/rest/services/Hosted/Parcel_Boundaries_of_Indiana_Current/FeatureServer/0/query?where=PARCEL_ID%3D%27570127400364000014%27&outFields=*&returnGeometry=true&outSR=4326&f=json; https://www.peeringdb.com/api/org?name__contains=Ligtel
- **site-c5d9f716a4** Lincoln Rackhouse Maryland (Lincoln Rackhouse) — Montgomery County, MD  
  parcel: owner not published · 10.0 ac · ref 160501999118 · md  
  **campus** / keep · owner is landlord · high — Parcel 160501999118 (Montgomery Co. district 05, account 01999118) is 12401 Prosperity Dr, Silver Spring MD 20904, Montgomery Industrial Park Lot 18, 435,600 SF = 10.0 ac, SDAT structure type "COMPUTER CENTER", built 2009, 200,098 sq ft enclosed. The county polygon (Montgomery County property_query layer) contains the site coordinate 39.058608,-76.  
  https://sdat.dat.maryland.gov/RealProperty/Pages/default.aspx; https://gis3.montgomerycountymd.gov/arcgis/rest/services/property/property_query/MapServer/0/query?where=ACCT%20LIKE%20%27%251999118%25%27&outFields=*&outSR=4326&f=json; https://colo.exchange/data-centers/lincoln-rackhouse-lincoln-rackhouse-silver-spring
- **site-f8b604010f** Login Tucson (Login, LLC) — Pima County, AZ  
  parcel: BRAVO TWO LLC · 1.0426 ac · ref 11502329L · az-04019 · +2 same-owner lot(s)  
  **campus** / keep · owner is spv · high — Pima County Assessor record for 115-02-329L (queried via the assessor's own API, tax year 2027): owner BRAVO TWO LLC, mailing address 1855 N 6TH AVE, TUCSON AZ 85705-5601; situs addresses 1855 N 6th Av and 1955 N 6th Av; 43,685 sq ft (1.00 ac, matches the dossier's 1.0426 ac); use code 1511 office; parcel centroid 32.24495/-110.96918, i.e. the site  
  https://www.asr.pima.gov/Parcel/GetParcel?parcel=11502329L; https://asr.pima.gov/AssessorSiteData/api/get/parceldetails/; https://www.asr.pima.gov/Parcel/GetParcel?parcel=11502329J
- **site-1c986906c8** Lumen Baltimore (Lumen Technologies) — Baltimore city, MD  
  parcel: owner not published · 9.126 ac · ref 0304100596 002 · md  
  **campus** / keep · owner is public · high — The polygon is the lot under One Market Center, 300 W Lexington St, Baltimore -- the carrier hotel that houses Lumen's Baltimore colocation (PeeringDB fac 925 'Lumen Baltimore', address '300 W Lexington', CLLI BLTMMDSN, 39.291768/-76.620065, inside the polygon; OSM way 336380960 'One Market Center' 300 W Lexington St with the Lumen and AiNET nodes   
  https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_ParcelBoundaries/MapServer/0/query?geometry=-76.620402,39.291759&geometryType=esriGeometryPoint&inSR=4326&outFields=*&f=json; https://pay.baltimorecity.gov/realproperty (Block 0596 / Lot 002 lookup, FY 2026/2027); https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_PropertyData/MapServer/0/query?where=ACCTID+LIKE+'0304100596%25'&outFields=*&f=json
- **site-852576041b** ORI.NET Noblesville (On-Ramp Indiana, Inc.) — Hamilton County, IN  
  parcel: owner not published · ? ac · ref 290731177009000013 · in  
  **campus** / keep · owner is spv · high — The queried parcel 29-07-31-177-009.000-013 is the lot under the facility. Its situs address in the Indiana statewide parcel layer (Hamilton County source) is exactly "859 Conner St", Noblesville 46060, which is the address PeeringDB gives for facility 8459 "ORI.NET Noblesville" (org On-Ramp Indiana, Inc.) at the identical lat/lon; the registry coo  
  https://www.peeringdb.com/api/fac?name__contains=ORI.NET; https://gisdata.in.gov/server/rest/services/Hosted/Parcel_Boundaries_of_Indiana_Current/FeatureServer/0/query?geometry=-86.013927,40.045407&geometryType=esriGeometryPoint&inSR=4326&outFields=*&f=json; https://secure2.hamiltoncounty.in.gov/PropertyReports/api/Property?selector=general&parcel=1107311707009000
- **site-a8e5e357c4** Oxford Networks (FirstLight) — Cumberland County, ME  
  parcel: owner not published · ? ac · ref 05030_40-87 · me  
  **campus** / keep · owner is landlord · high — The Maine statewide layer's polygon 05030_40-87 is Brunswick tax Map 040 Lot 087 (the dossier's locality 'Cumberland' is the county; the town is Brunswick, at Brunswick Landing / former NAS Brunswick). The Town of Brunswick's Vision assessor card for that Map/Lot (PID 101657) gives the situs as 14 RESILIENT CIR, 11.25 acres, TIF 'BRNS LNDG', buildi  
  https://services1.arcgis.com/RbMX0mRVOFNTdLzd/arcgis/rest/services/Maine_Parcels_Organized_Towns/FeatureServer/10/query?geometry=-69.923434,43.895157&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=true&outSR=4326&f=json; https://services1.arcgis.com/RbMX0mRVOFNTdLzd/arcgis/rest/services/Maine_Parcels_Organized_Towns/FeatureServer/9/query?where=STATE_ID%3D%2705030_40-87%27&outFields=*&f=json; https://gis.vgsi.com/brunswickme/Parcel.aspx?pid=101657
- **site-be8d0031b5** OzarksGo Fayetteville (OzarksGo, LLC) — Washington County, AR  
  parcel: OZARK ELECTRIC COOPERATIVE CORP · 0.0 ac · ref 765-13729-000 · ar · +3 same-owner lot(s)  
  **campus** / keep · owner is operator · high — Parcel 765-13729-000 (Washington County, AR; AGISO statewide CAMA layer) is recorded to OZARK ELECTRIC COOPERATIVE CORP with situs 3641 W WEDINGTON DR, Fayetteville, legal 'PT SW NW & PT NW SW 11.247 A.' (shape area ~44,085 m2, ~10.9 ac; the dossier's 0.0 acres is only an empty taxarea field). The site coordinate (36.077952, -94.212464) lies inside  
  https://gis.arkansas.gov/arcgis/rest/services/FEATURESERVICES/Planning_Cadastre/FeatureServer/6/query?geometry=-94.212464,36.077952&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&f=json; https://www.peeringdb.com/api/fac?name__contains=OzarksGo; https://www.ozarksgo.net/contact
- **site-9a215eda96** SITCO Evansville (Sitco Business Solutions, LLC) — Vanderburgh County, IN  
  parcel: owner not published · ? ac · ref 820610034349001020 · in  
  **campus** / keep · owner is landlord · high — The parcel is the lot under the facility. Indiana's statewide parcel layer gives parcel 820610034349001020 (82-06-10-034-349.001-020) the situs "4631 OHARA DR", Evansville 47711-2864, and a point-intersect query at the registry coordinate (38.019934, -87.521467) returns exactly this polygon (1.53 acres by computation). PeeringDB's facility record "  
  https://www.peeringdb.com/api/fac?name__contains=SITCO; https://www.peeringdb.com/api/org?name__contains=Sitco; https://gisdata.in.gov/server/rest/services/Hosted/Parcel_Boundaries_of_Indiana_Current/FeatureServer/0/query?where=state_parcel_id%3D%27820610034349001020%27&outFields=*&f=json
- **site-a16552457c** Servpac MTP DC (Servpac Inc.) — Honolulu County, HI  
  parcel: owner not published · 5.06806157 ac · ref 195046002 · hi  
  **campus** / keep · owner is spv · high — Parcel 195046002 is Honolulu TMK 1-9-5-046-002 (parid 950460020000). The Honolulu assessor's LEGDAT address table gives its situs as "200 KAHELU AVE", MILILANI HI 96789 — an exact match to the registry/PeeringDB address for Servpac MTP DC. The site coordinate (from PeeringDB fac 17093, which lists 21.480922/-158.019259 for 200 Kahelu Ave) falls ins  
  https://geodata.hawaii.gov/arcgis/rest/services/ParcelsZoning/MapServer/25/query?where=tmk_txt%3D%27195046002%27&outFields=*&outSR=4326&f=json; https://services.arcgis.com/tNJpAOha4mODLkXz/arcgis/rest/services/LEGDAT_ADDRESS/FeatureServer/1/query?where=parid%3D%27950460020000%27&outFields=*&f=json; https://services.arcgis.com/tNJpAOha4mODLkXz/arcgis/rest/services/PropertyReportInfo/FeatureServer/2/query?where=tmk%3D95046002&outFields=*&f=json
- **site-db7b14cb4c** Servpac Puahale DC (Servpac Inc.) — Honolulu County, HI  
  parcel: owner not published · 0.21805111 ac · ref 112001067 · hi  
  **campus** / keep · owner is spv · high — The parcel (Oahu TMK 1-1-2-001-067, 0.218 ac, Kalihi) is the lot carrying the 1931 N King St address, which is the address PeeringDB gives for "Servpac Puahale DC" (with exactly the registry's coordinate 21.331917, -157.87825) and the address Servpac's own contact page gives for its Honolulu office / Puahale DC. Honolulu's address-point layer place  
  https://www.peeringdb.com/api/fac?name__contains=Servpac; https://servpac.com/contact/; https://servpac.com/data-center-colocation/dual-site-colocation/
- **site-8772ec7862** Simply Bits DC1 (Simply Bits, LLC) — Pima County, AZ  
  parcel: JENICA ENTERPRISES LLC · 0.1522 ac · ref 124161140 · az-04019 · +4 same-owner lot(s)  
  **part** / keep · owner is landlord · high — The site coordinate (32.205098, -110.956748) is PeeringDB's own operator-entered record for "Simply Bits DC1" at 1300 S Park Ave, Tucson 85713, and it falls inside parcel 124-16-1140 (Bruckners Lot 14 Blk 14; bbox lat 32.20507-32.20521), just north of the lot line with 124-16-1130 (Lot 13). Pima County records give 1300 S PARK AV as the situs of bo  
  https://www.peeringdb.com/api/fac/2249; https://gis.pima.gov/maps/detail.cfm?p=124161140; https://gis.pima.gov/maps/detail.cfm?p=124161130
- **site-d46d91cfe9** TierPoint Baltimore BWI (TierPoint, LLC) — Anne Arundel County, MD  
  parcel: owner not published · 16.83 ac · ref 020510090233309 · md  
  **campus** / keep · owner is landlord · high — The parcel (MD SDAT acct 020510090233309, Anne Arundel Co.) is Lot 5 of BWI Technology Park with legal description "809-813 PINNACLE DR", situs 809 Pinnacle Dr, Linthicum Heights 21090, 16.83 ac (polygon 13.81 ac), an industrial flex building built 2013 of 53,800 sq ft; owner mailing address is "C/O ST JOHN PROPERTIES INC, 2560 Lord Baltimore Dr, B  
  https://www.tierpoint.com/data-centers/maryland/baltimore-bwi/; https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_ParcelBoundaries/MapServer/0/query?where=ACCTID%3D%27020510090233309%27&outFields=*&f=json; https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_ParcelBoundaries/MapServer/0/query?geometry=-76.682834,39.213455&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=ACCTID,ADDRESS,LEGAL2&f=json
- **site-83bd719a20** University of Maine - Neville Telecom Colo (University of Maine System) — Penobscot County, ME  
  parcel: owner not published · ? ac · ref 19490_11-00-077 · me  
  **campus** / keep · owner is operator · high — The queried parcel is Orono tax map 11 lot 77 (STATE_ID 19490_11-00-077) in the Maine GeoLibrary "Maine Parcels Organized Towns" layer. The polygon layer gives PROP_LOC "168 COLLEGE AVENUE" and Shape__Area 2,497,767 m2 (~617 ac); the related assessment table (FeatureServer table 9, joined on STATE_ID) records OWNER1 "UNIVERSITY OF MAINE", owner add  
  https://services1.arcgis.com/RbMX0mRVOFNTdLzd/arcgis/rest/services/Maine_Parcels_Organized_Towns/FeatureServer/10/query?where=STATE_ID%3D%2719490_11-00-077%27&outFields=*&f=json; https://services1.arcgis.com/RbMX0mRVOFNTdLzd/arcgis/rest/services/Maine_Parcels_Organized_Towns/FeatureServer/9/query?where=STATE_ID%3D%2719490_11-00-077%27&outFields=*&f=json; https://www.peeringdb.com/api/fac?name__contains=Neville
- **site-cc22c34163** Wintek Corporation (Wintek Corporation) — Tippecanoe County, IN  
  parcel: owner not published · ? ac · ref 790720437005000004 · in  
  **campus** / keep · owner is landlord · high — The parcel under the dot is Tippecanoe County parcel 79-07-20-437-005.000-004 whose situs address in both the state layer (dlgf_prop_address) and the county's own parcel feature service is "427 N 6TH ST", Lafayette IN 47901 — exactly the address Wintek publishes as its Lafayette headquarters and the address/coordinate PeeringDB records for the Wint  
  https://maps.tippecanoe.in.gov/server/rest/services/Parcels_FeatureService/FeatureServer/0/query?where=STKEY%3D%27790720437005000004%27&outFields=*&f=json; https://gisdata.in.gov/server/rest/services/Hosted/Parcel_Boundaries_of_Indiana_Current/FeatureServer/0/query?geometry=-86.890366,40.421474&geometryType=esriGeometryPoint&inSR=4326&outFields=*&f=json; https://www.peeringdb.com/api/fac?name__contains=Wintek
- **site-dacf58bf0d** ark data centers - Boise, ID (ark data centers) — Ada County, ID  
  parcel: owner not published · ? ac · ref R0056270250 · id  
  **campus** / keep · owner is operator · high — Parcel R0056270250 is the lot the Ark (ex-Involta) Boise 'Victory View' data center stands on. Ada County Assessor's own parcel service gives it the situs address 2653 S VICTORY VIEW WAY BOISE ID 83709, 12.635 ac, Commercial, I-1, total value $13,993,500, legal 'LOT 02 BLK 01 ACCESS SUB & POR SW4 SEC 24 3N 1E PAR A ROS 14188' (2026 roll). That is e  
  http://www.adacountyassessor.org/arcgis/rest/services/External/ExternalMap/MapServer/24/query?where=PARCEL%3D%27R0056270250%27&outFields=*&returnGeometry=false&f=json; http://www.adacountyassessor.org/arcgis/rest/services/External/ExternalMap/MapServer/16/query?where=AddNum%3D2653%20AND%20StName%3D%27VICTORY%20VIEW%27&outFields=*&outSR=4326&f=json; https://www.peeringdb.com/api/fac?name__contains=ark%20data&depth=0

## Kept without individual research (73 sites) — one named-owner lot, under 20 acres, an operating colocation site

The lot under the dot, with the owner the county names. Not researched one by one: a single commercial lot under an operating facility is the normal case, and the research budget went to the campuses. Listed so the scope is honest.

- site-09c0a1c2f6 (unnamed) () — South Central Connecticut Planning Region, CT: CELLCO PARTNERSHIP · 11 ac · ref 64-14 · ct
- site-00ae4bc616 (unnamed) (HostDime) — Orange County, FL: SH OTC LLC · ? ac · ref 352129000000094 · fl
- site-1cc1e934e1 (unnamed) () — Polk County, FL: AT&T WIRELESS SERVICES INC · ? ac · ref 252520000000043010 · fl
- site-9624de1a57 (unnamed) (CoreSite) — Miami-Dade County, FL: CRP MIA TELCO L P · ? ac · ref 0131271100010 · fl
- site-0a6d26703f 365 Data Centers Ft. Lauderdale (FLL) (365 Data Centers) — Broward County, FL: MYP COMMERCIAL PLACE LLC · ? ac · ref 494218200530 · fl
- site-ff0df693ef 3HCloud - MIA-1 (3HCLOUD LLC) — Miami-Dade County, FL: GLOBAL MIAMI ACQUISITION COMP · ? ac · ref 0101100501040 · fl
- site-0605a6d8a6 500 Green (AKA VOLICO 2.0) (Biznesshosting, Inc. DBA VOLICO) — Broward County, FL: STORAGE EXPRESS II INC · ? ac · ref 484211120010 · fl
- site-1519cac542 ACS North Wire Center (National Oceanic and Atmospheric Administration) — Anchorage Municipality, AK: ALASKA COMMUNICATIONS SYSTEMS STEPHEN S ASHWORTH · ? ac · ref 00215350001 · ak
- site-e322f8cf2d AceHost Tampa (AceHost) — Hillsborough County, FL: MADISON BUILDING INC · ? ac · ref 1829244ZI000056000010A · fl
- site-2555310fee AiNET DC-900S (AiNET) — District of Columbia, DC: NATIONAL RAILROAD PASSENGER CORPORATION AMTRAK · ? ac · ref 0717 0812 · dc
- site-cba446c055 Carrier Core - Tampa (Carrier Core, LLC) — Hillsborough County, FL: TWC FIFTY EIGHT LTD · ? ac · ref 1829244ZI000046000010A · fl
- site-8da0659db7 Center for Computation & Technology (CCT) () — East Baton Rouge Parish, LA: LOUISIANA STATE UNIVERSITY · ? ac · ref 2383357 · la-22033
- site-62c9039053 Cloudpath CT19 (5 Landmark Sq) (Cloudpath LLC) — Western Connecticut Planning Region, CT: LANDMARK SQUARE 1-6 LLC · 0 ac · ref S 013 0984 · ct
- site-500d8f9e6b Cogent Boca Raton (Cogent Communications, Inc.) — Palm Beach County, FL: G&I X BRIC FEE OWNER LLC · ? ac · ref 06424712150000010 · fl
- site-73f24f000e Colo Solutions Downtown Orlando (Colo Solutions, LLC) — Orange County, FL: CITY OF ORLANDO · ? ac · ref 352229000000006 · fl
- site-7f2744464f ColoHouse Miami (ColoHouse Premier Datacenter) — Miami-Dade County, FL: GLOBAL MIAMI ACQUISITION COMP · ? ac · ref 0101100501040 · fl
- site-b640f6d383 Cologix LAK1 (Cologix, Inc.) — Polk County, FL: RIVERBEND LAKELAND PROPERTIES · ? ac · ref 232802020501000100 · fl
- site-3e81c0d98c CoreSite - Miami (MI2) (CoreSite) — Miami-Dade County, FL: CORESITE REAL ESTATE MI2 LLC · ? ac · ref 3530340200010 · fl
- site-382c69d9f2 CoreSite - Orlando (OR1) (CoreSite) — Orange County, FL: CORESITE REAL ESTATE OR1 LLC · ? ac · ref 042429000000016 · fl
- site-39060fefbc CoreSite DC1 (CoreSite) — District of Columbia, DC: METRO K LLC · ? ac · ref 0284 0043 · dc
- site-4a4cbf6653 Crown Castle Hartford (960 Main) (Crown Castle Inc.) — Capitol Planning Region, CT: 960 MAIN ST CONDO ASSOC · 0 ac · ref 268350025 · ct
- site-16d0afb7eb CyrusOne Florence (CyrusOne Inc.) — Boone County, KY: CYRUSONE LLC · ? ac · ref 073.00-00-057.00 · ky-21015
- site-e0f5a654b7 DC Blox Data Center (DC BLOX Parent LLC) — Jefferson County, AL: DC BLOX INC · 11.92 ac · ref 2900021015001001 · al-01073
- site-4f57a20de2 DNSnetworks IDC4 (DNSnetworks Corporation) — Miami-Dade County, FL: GLOBAL MIAMI ACQUISITION COMP · ? ac · ref 0101100501040 · fl
- site-707a9de54c DartPoints Baton Rouge, LA - BTR1 (DartPoints, LLC) — East Baton Rouge Parish, LA: DARTPOINTS OPERATING COMPANY, LLC · ? ac · ref 30859811 · la-22033
- site-9aa585397a DataBank Miami (MIA1) (DataBank, Ltd.) — Miami-Dade County, FL: GLOBAL MIAMI ACQUISITION COMP · ? ac · ref 0101100501040 · fl
- site-4d3aee3f37 Digital Realty MIA (36 NE 2nd St) (Digital Realty) — Miami-Dade County, FL: GLOBAL MIAMI ACQUISITION COMP · ? ac · ref 0101100501040 · fl
- site-d9d902a888 E-Foam () — Orange County, FL: BRITT PLAZA LLC · ? ac · ref 132227089500180 · fl
- site-b177dda54d EdgeConneX Miami (EDCMIA01) (EdgeConneX Inc.) — Miami-Dade County, FL: EDGECONNEX MIAMI HOLDINGS LLC · ? ac · ref 2530310290025 · fl
- site-b4578323a4 EdgeConneX Miami (EDCMIA02) (EdgeConneX Inc.) — Miami-Dade County, FL: EDGECONNEX MIAMI HOLDINGS II L · ? ac · ref 3022060360060 · fl
- site-76591adb57 Equinix MI2 - Miami (Equinix, Inc.) — Miami-Dade County, FL: GLOBAL MIAMI ACQUISITION COMP · ? ac · ref 0101100501040 · fl
- site-c454f2798e Equinix MI6 - Miami, Doral (Equinix, Inc.) — Miami-Dade County, FL: EQUINIX LLC · ? ac · ref 3530320310010 · fl
- site-25ab6c1096 Ergonomic Group () — Capitol Planning Region, CT: 65 KREIGER LLC · 1 ac · ref 37900065 · ct
- site-e4e4b7ba52 Flexential Fort Lauderdale (Flexential) — Broward County, FL: LANDMARK DIGITAL INFRASTRUCTUR · ? ac · ref 494218160220 · fl
- site-03689351e4 Flexential Jacksonville (Flexential) — Duval County, FL: LD DI ASSETCO LLC · ? ac · ref 1525750805R · fl
- site-30a657b7c2 Flexential Tampa - North (Flexential) — Hillsborough County, FL: FLEXENTIAL LLC · ? ac · ref 1928019VJ0000000004B0A · fl
- site-227c43ebd8 Flexential Tampa - West (Flexential) — Hillsborough County, FL: EAST GROUP PROPERTIES LP · ? ac · ref 1828195RM000000A00000U · fl
- site-24b9d7ed8d Frontier Tampa Main Tandem Office (Frontier Florida LLC) — Hillsborough County, FL: 610 N MORGAN STREET LLC · ? ac · ref 1829244ZI000048000010A · fl
- site-7647ab5e5e Globenet Boca Raton CLS (Vtal) — Palm Beach County, FL: BRASIL TELECOM OF AMERICA INC · ? ac · ref 06434730010170080 · fl
- site-c2806e69a1 H5 Data Centers Tampa (H5 Data Centers) — Hillsborough County, FL: TWC FIFTY EIGHT LTD · ? ac · ref 1829244ZI000046000010A · fl
- site-de275a9bcb HDC1 - 108 Bank St (Colocation America Corporation) — Naugatuck Valley Planning Region, CT: 96-108 BANK STREET LLC · 0 ac · ref 029402700017 · ct
- site-da0f3ab435 HiPerGator (University of Florida) — Alachua County, FL: STATE OF FLA IIF · ? ac · ref 10808-000-000 · fl
- site-28cba368bd Hivelocity (Hivelocity LLC) — Hillsborough County, FL: WPT LAND 2 LP · ? ac · ref 18282916S000001000040U · fl
- site-6f1f2ae365 HostDime Orlando Tier IV Data Center (HostDime) — Orange County, FL: INNOVATIVE PLACE LAND LLC · ? ac · ref 352129000000194 · fl
- site-107f221bd0 Lawton Information Services, LLC (Lawton Information Services, LLC) — Polk County, FL: UNITED STATES POSTAL SERVICE · ? ac · ref 232913000000023060 · fl
- site-c423b9ed54 Lumen Jacksonville (Lumen Technologies Inc) — Duval County, FL: 4814 PHILLIPS HIGHWAY LLC · ? ac · ref 1529740010R · fl
- site-639b3a02c2 Lumen New Haven (Lumen Technologies Inc) — South Central Connecticut Planning Region, CT: GATEWAY PARTNERS LLC · 0 ac · ref 13539 · ct
- site-bce9a65ade Lumen Stamford (Lumen Technologies Inc) — Western Connecticut Planning Region, CT: HV ENTERPRISES LLC · 10 ac · ref W 003 3750 · ct
- site-e302f419b5 Lumen West Haven (Lumen Technologies Inc) — South Central Connecticut Planning Region, CT: QWEST COMMUNICATIONS CORP · 1 ac · ref 059-0109-0-0000 · ct
- site-ef13e96a0d MDC Nogales (MDC Data Centers) — Santa Cruz County, AZ: NIEBLA LOURDES NIEBLA RAUL · 0.0695 ac · ref 10146002 · az-04023
- site-82e285b3fc MDC1 - 36 NE 2nd St (Colocation America Corporation) — Miami-Dade County, FL: GLOBAL MIAMI ACQUISITION COMP · ? ac · ref 0101100501040 · fl
- site-c46008405f Mainstream Little Rock (Mainstream Technologies, Inc) — Pulaski County, AR: 325 WEST CAPITOL-COMMON CARD · 1.61 ac · ref 34L-020.47-000.00 · ar
- site-4eb96b7409 NAP of the Americas (Equinix, Inc.) — Miami-Dade County, FL: VERIZON DATA CENTERS V LLC · ? ac · ref 0101030801050 · fl
- site-da73481a5f NOLA BROADBAND (NOLA Broadband) — Jefferson Parish, LA: FAIRFIELD AVE TOWER LLC · ? ac · ref 0200000927 · la-22051
- site-78e4d15465 NWT Data Center (Biznesshosting, Inc. DBA VOLICO) — Miami-Dade County, FL: 124 NE 2 AVENUE REALTY INC · ? ac · ref 0101100401130 · fl
- site-48f3fdc82b Navégalo Data Center Miami (MI1) (Navégalo) — Miami-Dade County, FL: GLOBAL MIAMI ACQUISITION COMP · ? ac · ref 0101100501040 · fl
- site-bc7fd8f8eb NocRoom Miami IT Services () — Miami-Dade County, FL: MIAMI-DADE COUNTY · ? ac · ref 3059150000010 · fl
- site-facf4591b9 Peer-Point Colocation (Peer-Point Services, LLC) — Miami-Dade County, FL: BRICKELL HOLDINGS LLC · ? ac · ref 0102100301330 · fl
- site-43b250cd5f RSA Dexter Avenue Datacenter (Retirement Systems of Alabama (RSA)) — Montgomery County, AL: EMPLOYEES RETIREMENT SYSTEM & TEACHERS RETIREMENT SYSTEM · 1.64477783 ac · ref 1003073301024000 · al-01101
- site-47f1286aed SD / Comsat Southbury Ground Station (SD Data Center) — Naugatuck Valley Planning Region, CT: GOONHILLY HOLDINGS USA INC · 16 ac · ref 9-90-37A · ct
- site-62c96d31bb SKYLINK DATA CENTERS (SKYLINK DATA CENTERS) — Collier County, FL: 801 ORCHID LLC · ? ac · ref 06288160009 · fl
- site-08f8b795cf Smart City Telecom Maitland Colo (Smart City Telecom) — Orange County, FL: DAVIS RICHARD T TR · ? ac · ref 272129584400050 · fl
- site-94e724b18e South Reach Networks (South Reach Networks) — Miami-Dade County, FL: GLOBAL MIAMI ACQUISITION COMP · ? ac · ref 0101100501040 · fl
- site-719589a707 T-Mobile Everglades MSO Data Center () — Broward County, FL: USPP SUNRISE DC LLC · ? ac · ref 494118220020 · fl
- site-271483fef0 Telxius Boca Raton DC (Telxius Cable) — Palm Beach County, FL: TELEFONICA INT'L WHOLESALE · ? ac · ref 06424701010030050 · fl
- site-7f8f7ae812 The Franklin Exchange Tampa (The Wilson Company) — Hillsborough County, FL: TWC FIFTY EIGHT LTD · ? ac · ref 1829244ZI000046000010A · fl
- site-cbb04d4f77 TierPoint Little Rock (TierPoint, LLC) — Pulaski County, AR: TIERPOINT PROPERTIES LLC · 2.73 ac · ref 44L-075.02-001.00 · ar
- site-683913e87f TierPoint Waterbury (TierPoint, LLC) — Naugatuck Valley Planning Region, CT: 96-108 BANK STREET LLC · 0 ac · ref 029402700017 · ct
- site-111458a6bb WOW! Business (Tampa Datacenter) (WideOpenWest Finance) — Hillsborough County, FL: CIO PARK TOWER LP · ? ac · ref 1829244ZI000062000010A · fl
- site-4d48388467 Zayo Washington DC - 2100 M Street NW (Zayo Group) — District of Columbia, DC: BXP 2100M LLC · ? ac · ref 0072 0075 · dc
- site-b9c17c49af amnet Data Center (Cloudpath LLC) — Western Connecticut Planning Region, CT: FAHEY LLC · 0 ac · ref N 005 2914 · ct
- site-a95597dea5 ark data centers - Tucson, AZ (ark data centers) — Pima County, AZ: INVOLTA LLC · 4.4869 ac · ref 13217130A · az-04019
- site-e207c58939 iM Critical Miami (iM Critical) — Miami-Dade County, FL: IMDC MIAMI LLC · ? ac · ref 0131120120050 · fl

## Bounded by the final pull, not yet vetted (343 sites)

The county layers found after the vetting pass ran. The lot under the dot, unjudged: the next vetting sweep should start here, AI sites first.

- **site-9831895491** Amazon AWS PHL (Amazon) — Luzerne County, PA: AMAZON DATA SERVICES INC · ? ac · ref 55O4 00A101000 · pa-42079 · +20 same-owner lot(s)
- **site-6de79747d8** Amazon Web Services (Amazon Web Services) — Madison County, MS: AMAZON DATA SERVICES INC · 61 ac · ref 071H-34B-001/02.00 · ms-28089 · +17 same-owner lot(s)
- **site-b034c54b77** Anthropic Lake Mariner (AI XPV Platform) — Niagara County, NY: Somerset Operating Co. LLC · 0.0 ac · ref 8.00-1-1.11 · ny-36063 · +6 same-owner lot(s)
- **site-d561c8dc4c** Core42 Lake Mariner (Core42) — Niagara County, NY: Somerset Operating Co. LLC · 0.0 ac · ref 8.00-1-1.11 · ny-36063 · +6 same-owner lot(s)
- **site-884d6b0029** CoreWeave Dalton 1 & 2 (CoreWeave) — Whitfield County, GA: DALTON WHITFIELD JOINT DEVELOPMENT · 4.95 ac · ref 13-025-01-015 · ga-13313
- **site-560b0d10da** CoreWeave Denton TX (CoreWeave) — Denton County, TX: DENTON, CITY OF · 11.256 ac · ref 1073009 · tx-48121
- **site-f24da2b13a** Globe Digital Holdings Niagara Falls (Globe DH LLC) — Niagara County, NY: Highland Ave NY 3801 LLC · 15.9 ac · ref 130.14-2-41 · ny-36063 · +15 same-owner lot(s)
- **site-e111650453** Google (Google) — Wasco County, OR: DESIGN LLC · 90.50462 ac · ref 2N 13E 28 700 · or-41065 · +1 same-owner lot(s)
- **site-57b27affa4** Google Cedar Rapids (Google) — Linn County, IA: HEAVISIDE LLC · 408.92 ac · ref 201315100300000 · ia-19113
- **site-d2d6ce0920** Google Lincoln (Google) — Lancaster County, NE: AGATE LLC · ? ac · ref 1820301001000 · ne-31109 · +3 same-owner lot(s)
- **site-ef3905a031** Google Omaha (Google) — Douglas County, NE: owner not published · 0.0 ac · ref 0552245320116 · ne
- **site-c1f1dfb23f** Google Project Tembo (Google) — Laramie County, WY: GIRARD, SEAN · 8.850408 ac · ref 12660340101100 · wy
- **site-3fe7b1462d** Meta Cheyenne (Meta) — Laramie County, WY: owner not published · 0 ac · ref 14663124300100 · wy
- **site-7d72682aeb** Meta Temple (Meta) — Bell County, TX: POLMER LLC · 384.037 ac · ref 514967 · tx-48027
- **site-24883805b4** Microsoft Fairwater Wisconsin (Microsoft) — Racine County, WI: MICROSOFT CORPORATION · 319.13 ac · ref 151032233004010 · wi
- **site-eaefc40982** Microsoft-Nebius New Jersey (Nebius) — Cumberland County, NJ: NEP R E OF VINELAND NJ URBAN RENEW · 10 ac · ref 0614_7503_46 · nj-34011 · +13 same-owner lot(s)
- **site-0adf271aee** OpenAI Project Camellia (OpenAI) — Effingham County, GA: DIXON CRAIG F AND KATHI W · 5.38004212 ac · ref 0450D042 · ga-13103
- **site-ecf2b9f202** QTS Cedar Rapids () — Linn County, IA: QTS CEDAR RAPIDS I DC2 LLC · 53.77 ac · ref 201540100200000 · ia-19113
- **site-271c0a5d3e** QTS Eagle Mountain () — Utah County, UT: owner not published · ? ac · ref 387070013 · ut
- **site-b66aebf3a0** Treetop East Fishkill Data Center (Treetop Companies) — Dutchess County, NY: owner not published · ? ac · ref 6455-00-267493-0000 · ny-36027
- **site-eb4a572344** ZeroC Massena Data Center (ZeroC Data Centers (Petawatt Holdings)) — St. Lawrence County, NY: Zeroc Data Centers, LLC · 67.76281876 ac · ref 10.001-1-7.21 · ny
- site-69e4d1a777 (unnamed) () — Madison County, AL: STARBELT LLC · 205 ac · ref 07-05-22-0-000-013.000 · al-01089 · +3 same-owner lot(s)
- site-2ab7bf4fab (unnamed) () — Cobb County, GA: SOUTHERN BELL TELEPHONE & TELEGRAPH · 0.0 ac · ref 20003100040 · ga-13067
- site-74fc5d7f4d (unnamed) () — DuPage County, IL: CELLULAR ONE SITE 260 · 1.68 ac · ref 0133301036 · il-17043
- site-8923400c87 (unnamed) (SC) — Barber County, KS: SOUTH CENTRAL TELEPHONE ASSC · ? ac · ref 004-141-11-0-10-06-017.02-0 · ks-20007 · +2 same-owner lot(s)
- site-ad094d697b (unnamed) () — Monroe County, MI: STAMMER BRUCE R & DARLENE M TRUST · 1 ac · ref 02 005 028 00 · mi-26115
- site-dc2080cbb1 (unnamed) (CenturyLink) — Doña Ana County, NM: Centurylink Inc Attn: Property Tax · 0 ac · ref 4010135169209 · nm-35013
- site-ab723343bb (unnamed) (US Bitcoin) — Niagara County, NY: 2747 Buffalo Avenue LLC · 5.78 ac · ref 159.15-1-19 · ny-36063
- site-f7e64e172f (unnamed) (Blockfusion) — Niagara County, NY: Double C Realty of NY Inc · 3.0 ac · ref 161.19-5-51.1 · ny-36063
- site-ffbfe22253 (unnamed) () — Tulsa County, OK: EASYTEL COMMUNICATIONS INC · 0.7251 ac · ref 75200943126620 · ok-40143
- site-023583e4d0 (unnamed) () — Davidson County, TN: DELTACOM, LLC · 0.68 ac · ref 10507016900 · tn-47037
- site-454336c79f (unnamed) (TierPoint) — Johnson County, KS: owner not published · 4.84765374 ac · ref 0460820902004002000 · ks-20091
- site-60241eb0cf (unnamed) () — Johnson County, KS: owner not published · 20.57156589 ac · ref 0460920901005002000 · ks-20091
- site-6e0e311cba (unnamed) (amazon web services) — Morrow County, OR: owner not published · 106.89 ac · ref 2504.00N24.00E0000--000000138 · or-41049
- site-73baf1f9d2 (unnamed) (Verizon) — Hennepin County, MN: 1200 Washington Building Llc · 3.02 ac · ref 27053-2202924210082 · mn
- site-5f23fd8296 (unnamed) () — Granite County, MT: BLACKFOOT TELE CO-OPERATIVE · 0.13836998 ac · ref 46157325108020000 · mt
- site-8c3e261116 (unnamed) () — Grainger County, TN: CITIZENS TELECOMM CO · 1.68 ac · ref 029032 06001 · tn
- site-036d58e7ec (unnamed) () — Dane County, WI: WISCONSIN TELEPHONE CO ASSISTANT SECRETARY · 0.55 ac · ref 070921301324 · wi
- site-0ae27f46f2 (unnamed) () — Columbia County, WI: MAGNUM COMMUNICATIONS, INC · 10.67 ac · ref 2249720 · wi
- site-284b5d6a1a (unnamed) () — Racine County, WI: FEWI DEVELOPMENT CORPORATION · 864.52 ac · ref 151032232013010 · wi · +4 same-owner lot(s)
- site-2fbd22b425 (unnamed) (West Wisconsin Telcom) — Dunn County, WI: WEST WISCONSIN TELCOM · 0 ac · ref 1725122813264200029 · wi
- site-aa0982d720 (unnamed) (Involta) — Calumet County, WI: INVOLTA LLC · 24.58 ac · ref 39566 · wi
- site-18f7f85c2e (unnamed) () — Laramie County, WY: MICROSOFT CORPORATION · 249.44 ac · ref 13662830200100 · wy
- site-ab60bce782 (unnamed) () — Campbell County, WY: owner not published · 0 ac · ref 49730000125300 · wy
- site-1f599095a7 (unnamed) (FirstLight) — Rockingham County, NH: owner not published · ? ac · ref 084178-0311-0002-0000 · nh
- site-9599644981 (unnamed) (University of New Hampshire) — Strafford County, NH: owner not published · ? ac · ref 094062-013-003-001UNH · nh
- site-255848b7a2 (unnamed) () — Venango County, PA: owner not published · ? ac · ref 27,001.-003..-000 · pa
- site-9e4ac0dd01 1025Connect (1025Connect (formerly LIDARC)) — Nassau County, NY: owner not published · 1.9559 ac · ref 11080 00920 · ny-36059
- site-8540c17caf 1101 Stewart Ave, Garden City (1101 Stewart Ave, Garden City) — Nassau County, NY: owner not published · 2.37 ac · ref 44074 00300 · ny-36059
- site-e8531dfcf6 123 Central (bigbyte.cc) — Bernalillo County, NM: Santa Fe Pacific Trust Inc · 1.8069 ac · ref 101405724943724301 · nm-35001
- site-5e1eb67b4e 123.NET - DC1 - 24700 Northwestern Hwy. (123.Net, LLC.) — Oakland County, MI: owner not published · ? ac · ref 2426101007 · mi-26125
- site-a16f5a39e4 123.NET - DC4 - 400 76th St SW (123.Net, LLC.) — Kent County, MI: 76 BUSINESS COMPLEX LLC · 6.56216562 ac · ref 41-21-13-100-090 · mi-26081
- site-14641e2114 200 South Virginia - Reno (Basin Street Properties - Tahoe - Reno) — Washoe County, NV: owner not published · 0.57434963 ac · ref 1117105 · nv
- site-3472cfcdf7 232 20th St NW, East Grand Forks (Wikstrom Telephone Company, Inc.) — Polk County, MN: Polar Com Mutual Aid/Crookston · 0.51652505 ac · ref 27119-83-02823-02 · mn
- site-c4366ca601 324 E Wisconsin (Wells Interconnection) — Milwaukee County, WI: 1547 CSR-MILWAUKEE LLC · 0.28 ac · ref 3920728000 · wi
- site-b4109667bd 365 Data Centers Philadelphia (PH2) (365 Data Centers) — Philadelphia County, PA: owner not published · ? ac · ref 1001036601 · pa
- site-70e49a689f 365 Data Centers Smyrna (GA2) (365 Data Centers) — Cobb County, GA: LMRK DI PROPCO LLC · 11.24 ac · ref 17047600400 · ga-13067
- site-1e8a53153f 421 N 6th Ave East (ark data centers) — St. Louis County, MN: Smdc Health System · 1.28764642 ac · ref 27137-010-1010-01830 · mn
- site-8c9970f641 505 Marquette (Centersquare) — Bernalillo County, NM: 505 Marquette Fee Llc · 0.978 ac · ref 101405813804331402 · nm-35001
- site-91e0d38233 5Nines Data (5Nines Data / Network222) — Dane County, WI: WEST WASHINGTON LAND LLC · 1.2 ac · ref 070923108017 · wi
- site-3fc81b7b79 702 Communications - Fargo, ND (702 Communications) — Cass County, ND: owner not published · 0.36739829 ac · ref 38017-1-4021-00267-000 · nd
- site-bd0f1a13f4 702 Communications - Moorhead, MN (702 Communications) — Clay County, MN: Valed Joint Venture · 0.28523642 ac · ref 27027-585750290 · mn
- site-1a60853236 833 Chestnut Street (HCP Inc.) — Philadelphia County, PA: owner not published · ? ac · ref 1001038892 · pa
- site-09dd8a9971 901 Commerce Dr (Marshfield Clinic Inc.) — Wood County, WI: VINCENT MARSHFIELD EDGE LLC · 7.75 ac · ref 3303548I · wi
- site-91e0ba29bf ACT Buffalo (Advanced Communications Technology) — Johnson County, WY: LX BAR MEAT COMPANY LLC · 1.22 ac · ref 51822540018100 · wy
- site-51c563a01f ACT Casper (Advanced Communications Technology) — Natrona County, WY: ADVANCED COMMUNICATIONS TECHNOLOGY INC · 0.112489 ac · ref 33790441002000 · wy · +1 same-owner lot(s)
- site-6c217a1231 ACT Douglas (Advanced Communications Technology) — Converse County, WY: owner not published · 0 ac · ref 32712320090200 · wy
- site-022f5e2468 ACT Gillette (Advanced Communications Technology) — Campbell County, WY: owner not published · 0 ac · ref 49720340400300 · wy
- site-03ec6d8c3e ACT Riverton (Advanced Communications Technology) — Fremont County, WY: owner not published · 0 ac · ref 91143411700600 · wy
- site-8a2116a76e ACT Sheridan (Advanced Communications Technology) — Sheridan County, WY: S & J RENTAL ENTERPRISES · 0.09 ac · ref 56842741001225 · wy · +1 same-owner lot(s)
- site-f621b97d40 ACT Wheatland (Advanced Communications Technology) — Platte County, WY: ADVANCED COMMUNICATION TECHNOLOGY · 0.89 ac · ref 246823101001CM · wy · +1 same-owner lot(s)
- site-6bb1ba14f9 AUBix Auburn (AUBix LLC) — Lee County, AL: AUBIX LLC · 5.64 ac · ref 08 07 26 0 000 025.005 · al-01081
- site-6a74160939 Advanced Operations Center (University of Minnesota) — Hennepin County, MN: Regents of Univ of Mn · 43.55 ac · ref 27053-1902923330031 · mn
- site-0a94e2a13a Aligned Salt Lake (SLC-02) (Aligned Data Centers) — Salt Lake County, UT: owner not published · ? ac · ref 27054260030000 · ut
- site-963e4fa61d Allentown-TekPark (Colocation America Corporation) — Lehigh County, PA: owner not published · ? ac · ref 545408213261 · pa
- site-d1d0d95404 Alpha Federal (Alpha Innovations) — Kanawha County, WV: OODA LLC C/O ALPHA TECHNOLOGIES INC · 8.80350315 ac · ref 20-22-0042-0001-0004 · wv
- site-5c526dbc1f Amazon Web Services (Amazon Web Services) — Umatilla County, OR: AMAZON DATA SERVICES INC · 86.21 ac · ref 4N28240000600 · or-41059
- site-72ee5ad356 Amazon Web Services (Amazon Web Services) — Umatilla County, OR: AMAZON DATA SERVICES INC · 113.62 ac · ref 4N28230000220 · or-41059 · +1 same-owner lot(s)
- site-d08de30ceb Amazon Web Services (Amazon Web Services) — Umatilla County, OR: AMAZON DATA SERVICES INC · 163.28 ac · ref 5N28000002501 · or-41059 · +2 same-owner lot(s)
- site-851e4cc193 Amazon Web Services (Amazon Web Services) — Morrow County, OR: owner not published · 98.44 ac · ref 2504.00N26.00E0700--000000103 · or-41049
- site-9ae233f34e Amazon Web Services (Amazon Web Services) — Morrow County, OR: owner not published · 114.24 ac · ref 2504.00N25.00E2400--000000100 · or-41049
- site-e45475027d Amazon Web Services (Amazon Web Services) — Morrow County, OR: owner not published · 94.87 ac · ref 2504.00N26.00E0600--000000106 · or-41049
- site-ba1e47a05f Applied Digital () — Cass County, ND: owner not published · 24.81314263 ac · ref 38017-75-0500-00260-050 · nd
- site-2ce79b683e Atomic Data MSP250 (Atomic Data LLC) — Hennepin County, MN: Pacific Oak Sor Marquette Pl · 2.48 ac · ref 27053-2202924410012 · mn
- site-5b08fe7ecd Aunalytics Kalamazoo Datacenter (Aunalytics) — Kalamazoo County, MI: DEVRIES PARTNERS PROPERTIES LLC · 5.94 ac · ref 05-35-450-215 · mi-26077
- site-face770b89 Aunalytics South Bend Datacenter (AUSB) (Aunalytics) — St. Joseph County, IN: owner not published · ? ac · ref 710814276033000026 · in
- site-97cbd647c4 BNY Mellon Somerset (Digital Realty) — Somerset County, NJ: owner not published · 19.63 ac · ref 1808_517.04_2.10 · nj
- site-fb3eb9e984 Beloit-NOC (North Central Kansas Community Network Co.) — Mitchell County, KS: NORTH CENTRAL KANSAS COMMUNITY NETWORK CO · 0.0918277593004362 ac · ref 0620920902049016000 · ks-20123
- site-7d4517f13c Bluebird Underground Data Center (Bluebird Fiber) — Greene County, MO: SPRINGFIELD UNDERGROUND INC · 191.64 ac · ref 881210400083 · mo-29077
- site-40f7eb4096 BluegrassNet Louisville (Intermart Inc.) — Jefferson County, KY: owner not published · ? ac · ref 030D00420000 · ky-21111
- site-6278f52540 C Spire Mississippi (C Spire) — Oktibbeha County, MS: CELLULAR SOUTH REAL ESTATE INC · 0 ac · ref 117 -36-031.09 · ms-28105
- site-7710a76dca CENTRA RNO01 - Reno Nevada (200 S. Virginia) (CENTRA Digital Interconnect) — Washoe County, NV: owner not published · 0.57434963 ac · ref 1117105 · nv
- site-e1ec6a5bb9 Carfax () — Boone County, MO: SAGO COLUMBIA OFFICE LLC · ? ac · ref 1740400010080001 · mo-29019 · +1 same-owner lot(s)
- site-1287a80354 Centersquare Elk Grove Village Data Center Campus ORD2 (Centersquare) — DuPage County, IL: 2425 BUSSE RD LLC · 8.12 ac · ref 0302106001 · il-17043
- site-b32405ecd6 Centersquare Minneapolis (MSP1) (Centersquare) — Scott County, MN: 4450 Dean Lakes Boulevard Llc · 11.59 ac · ref 27139-274290020 · mn
- site-df90a9947a Central Office (AT&T) — Walworth County, WI: AT&T PROPERY MANAGEMENT · 0.33 ac · ref /OT 00087 · wi
- site-8b71112301 CentriLogic Rochester (ROC) (CentriLogic) — Monroe County, NY: owner not published · 1.88 ac · ref 26140010460000010070090000 · ny-36055
- site-f5835469bb CenturyLink (CenturyLink) — Marion County, OR: LUMEN TECHNOLOGIES INC ATTN: TAX MANAGER · 0 ac · ref 073W27AA03800 · or-41047-2 · +10 same-owner lot(s)
- site-646eb5bb34 CenturyLink () — Clark County, NV: owner not published · 1.25755903 ac · ref 14029602001 · nv
- site-84745b1041 CenturyLink (Lumen Technologies) — Clark County, NV: owner not published · 1.13260493 ac · ref 16107501003 · nv
- site-af0f67af3f CenturyLink (Lumen Technologies Inc) — Fulton County, GA: owner not published · ? ac · ref 14 00500015C02 · ga-13121-digest2018
- site-5debc37a9e Citynet Bridgeport (Citynet) — Harrison County, WV: CITYNET PROPERTIES LLC · 2.82696904 ac · ref 17-16-033B-0011-0001 · wv · +1 same-owner lot(s)
- site-28412a83b5 Citynet Charleston (Citynet) — Kanawha County, WV: REMINGTON CHARLESTON CORPORATION · 3.20764365 ac · ref 20-11-0003-0021-0000 · wv
- site-e72b7406e1 Citynet Pittsburgh (Citynet) — Allegheny County, PA: owner not published · ? ac · ref 0008M00004000000 · pa
- site-5d09f7629a Cloud Storage Corp () — Ellis County, KS: FOREST TOP LLC · ? ac · ref 026-138-34-0-40-17-008.00-0 · ks-20051
- site-b5e7a42400 Cogent Billings (Cogent Communications, Inc.) — Yellowstone County, MT: SPRINT COMMUNICATIONS CO LP · 1.19880565 ac · ref 03092613301210000 · mt
- site-865aef8231 Cogent Cheyenne (Cogent Communications, Inc.) — Laramie County, WY: owner not published · 0 ac · ref 13660610600100 · wy
- site-1ca179cb8d Cogent Fairfax (Cogent Communications, Inc.) — Allendale County, SC: U S SPRINT COMM CO · 0.72739549 ac · ref 123-06-04-15-000 · sc · +1 same-owner lot(s)
- site-9a0610c093 Cogent St Louis (Cogent Communications, Inc.) — St. Louis city, MO: US SPRINT COMMUNICATIONS CO LP · ? ac · ref 22829400000 · mo-29510
- site-1665bf7cd3 ColoCenter.com - Manchester NH (G4 Communications Corp.) — Hillsborough County, NH: owner not published · ? ac · ref 064134-435-9 · nh
- site-21611f90a2 ColoSpace - Bedford, NH (FirstLight Fiber, Inc.) — Hillsborough County, NH: owner not published · ? ac · ref 064017-35-98-23 · nh
- site-95e163ebb9 Columbia County Community Broadband Utility (Columbia County Community Broadband Utility) — Columbia County, GA: COLUMBIA COUNTY BOARD OF · 5.42613624 ac · ref 072 252 · ga-13073
- site-b865c1f6f5 Consolidated - 266 Main St. (Consolidated Communications, Inc.) — Chittenden County, VT: TELEPHONE OPERATING COMPANY OF VERMONT · 1.01 ac · ref 114-035-17394 · vt
- site-bd550d9e3f Consolidated - 770 Elm St. (Consolidated Communications, Inc.) — Hillsborough County, NH: owner not published · ? ac · ref 064134-153-3 · nh
- site-73684f6793 CoreSite AT2 - Marietta Data Center (CoreSite) — Cobb County, GA: CORESITE REAL ESTATE AT2 LLC · 6.47 ac · ref 17079800070 · ga-13067
- site-834f507f42 Crown Castle Pittsburgh (Allegheny Center Mall) (Crown Castle Inc.) — Allegheny County, PA: owner not published · ? ac · ref 0008C00236000200 · pa
- site-6ccc33e0df Crown Castle Providence (300 Carpenter) (Crown Castle Inc.) — Providence County, RI: owner not published · 0.10799476 ac · ref PR 032-0432-0000 · ri
- site-0a614d8444 CyrusOne Austin Data Center II (CyrusOne Inc.) — Travis County, TX: C1 AUSTIN II LLC · 6.04738569 ac · ref 0316180505 · tx-48453
- site-b811370c6c CyrusOne CHI3 (CyrusOne) — DuPage County, IL: C1 CHICAGO AURORA III LLC · 21.01 ac · ref 0706401015 · il-17043 · +4 same-owner lot(s)
- site-3fd51aa93e CyrusOne Chicago (Lombard) (CyrusOne Inc.) — DuPage County, IL: C1 CHICAGO LOMBARD LLC · 4.52 ac · ref 0619304014 · il-17043
- site-9ba3239c3d DC BLOX ATL1 - DCBLOX Atlanta (DC BLOX Parent LLC) — DeKalb County, GA: ATLANTA REAL ESTATE HOLDINGS LLC · 3.19 ac · ref 18 155 03 001 · ga-13089 · +5 same-owner lot(s)
- site-24286d9f05 DC BLOX GSP1 - DCBLOX Greenville (DC BLOX Parent LLC) — Greenville County, SC: DC BLOX INC · 8.39 ac · ref M011010100337 · sc-45045
- site-f3b2266759 DC BLOX HSV1 - DCBLOX Huntsville (DC BLOX Parent LLC) — Madison County, AL: DC BLOX LLC · 5.1 ac · ref 16-01-12-0-000-011.011 · al-01089-isv · +1 same-owner lot(s)
- site-2ba6774d4c DC BLOX Myrtle Beach Cable Landing Station (DC BLOX Parent LLC) — Horry County, SC: DC BLOX LLC · 20.24 ac · ref 44200000039 · sc-45051 · +1 same-owner lot(s)
- site-2a7f2d9e3c DC Blox Chattanooga (DC BLOX Parent LLC) — Hamilton County, TN: DC BLOX INC · ? ac · ref 146P H 009 · tn-47065
- site-d29df9bdf4 DQE Communications (Allegheny Center Mall) (DQE Communications LLC) — Allegheny County, PA: owner not published · ? ac · ref 0008C00236000200 · pa
- site-27bbe650f7 DQE Communications (Butler) (DQE Communications LLC) — Butler County, PA: owner not published · ? ac · ref 563- 26- 39-0000 · pa
- site-7f639899d2 DQE Communications (Downtown Pittsburgh) (DQE Communications LLC) — Allegheny County, PA: owner not published · ? ac · ref 0001H00334000000 · pa
- site-5807f024e6 Dakota Carrier Network (Dakota Carrier Network) — Cass County, ND: owner not published · 10.31132316 ac · ref 38017-1-5800-00301-000 · nd
- site-2a514b7f27 DartPoints Charleston, SC - CHS1 (DartPoints, LLC) — Charleston County, SC: HIGH GROUND PROPERTY LLC · 3.02 ac · ref 3930000184 · sc-45019
- site-6f098ae7c3 DartPoints Columbia, SC - CAE1 (DartPoints, LLC) — Richland County, SC: SOUTH CAROLINA RESEARCH AUTH · 0 ac · ref R11301-02-01 · sc-45079
- site-ee78954cac DartPoints Greenville, SC - GSP1 (DartPoints, LLC) — Greenville County, SC: DARTPOINTS OPRATING COMPANY LL · 2.78 ac · ref M011010100344 · sc-45045
- site-743cb53ebc DartPoints Spartanburg, SC - SPA1 (DartPoints, LLC) — Spartanburg County, SC: PROTECH US HOLDING INC · 6.148 ac · ref 2-54-00-007.06 · sc-45083
- site-3d040d7fb1 Data Center Lenexa (DataBank, Ltd.) — Johnson County, KS: owner not published · 7.22354389 ac · ref 0460841702022001000 · ks-20091
- site-5f9271c2b4 Data Holdings Data Center (Stack41, LLC) — Milwaukee County, WI: THE USA IN TRUST FOR FOREST · 2.48 ac · ref 3881713130 · wi
- site-4585b9e7cb DataBank Austin (AUS1) (DataBank, Ltd.) — Williamson County, TX: TRINITY, NATIONAL CORP · 1.037 ac · ref R066523 · tx-48491 · +2 same-owner lot(s)
- site-f81e4b1e7e DataBank Chicago (ORD4) (DataBank, Ltd.) — DuPage County, IL: CENTERPOINT PROPERTIES TR · 8.65 ac · ref 0624402019 · il-17043
- site-09d517192b DataBank Las Vegas LAS1 (DataBank) — Clark County, NV: owner not published · 4.27378663 ac · ref 17703413014 · nv
- site-684862db5c DataBank Memphis (MEM1) (DataBank, Ltd.) — Shelby County, TN: GREGORY REALTY GP · ? ac · ref 092005 00045 · tn-47157 · +1 same-owner lot(s)
- site-c1454d11a9 DataBank Minneapolis (MSP1) (DataBank, Ltd.) — Hennepin County, MN: 7700 France Avenue Llc · 12.88 ac · ref 27053-3102824440014 · mn
- site-d60fc1d301 DataBank Pittsburgh (PIT1) (DataBank, Ltd.) — Allegheny County, PA: owner not published · ? ac · ref 0008C00236000200 · pa
- site-ec0ed36e8b DataBank Pittsburgh PIT2 (DataBank, Ltd.) — Allegheny County, PA: owner not published · ? ac · ref 0497B00001000000 · pa
- site-f4a308280d Datacenter (386) (UChicago Argonne LLC) — DuPage County, IL: UNITED STATES OF AMERICA · 644.05 ac · ref 1009100002 · il-17043
- site-da975a2abc Date Center West - Eugene (Data Center West, Inc.) — Jackson County, OR: DATA CENTER WEST LAND LLC · 0.11 ac · ref 372W24DC15401 · or-41029 · +2 same-owner lot(s)
- site-0f96c7797e Date Center West - Eugene (Data Center West, Inc.) — Lane County, OR: Eugene Tower Associates · 0.6200369 ac · ref 1703311300700 · or-41039 · +4 same-owner lot(s)
- site-411a680ade Digital Realty New York JFK13 (Digital Realty) — New York County, NY: 32 SIXTH AVENUE CO LLC · 1.07103771 ac · ref 1001920001 · ny
- site-58a4a4bf1c Direct LTx Reading (Directlink Technologies Corp.) — Berks County, PA: owner not published · ? ac · ref 27439801265502 · pa
- site-db9bc864a3 Duluth Missabe (First Properties) — St. Louis County, MN: Lion Management Llc · 0.32183541 ac · ref 27137-010-0940-00380 · mn
- site-74e7612d4f EdgeConneX Las Vegas (EDCLAS01) (EdgeConneX Inc.) — Clark County, NV: owner not published · 1.42395396 ac · ref 17702215005 · nv
- site-ecbe8352fa EdgeConneX Madison (EDCMAD01) (EdgeConneX Inc.) — Dane County, WI: NOT AVAILABLE · 4.42 ac · ref 071022303194 · wi
- site-4a2c99e3be EdgeConneX Memphis (EDCMEM01) (EdgeConneX Inc.) — Shelby County, TN: GREGORY REALTY GP · ? ac · ref 093413 A00003C · tn-47157 · +8 same-owner lot(s)
- site-cd97c361b4 EdgeConneX Minneapolis (EDCMSP01) (EdgeConneX Inc.) — Hennepin County, MN: Edgeconnex Mpls Holdings Llc · 2.69 ac · ref 27053-0111622440017 · mn
- site-4c2c3cda94 EdgeConneX Nashville (EDCNAS01) (EdgeConneX Inc.) — Davidson County, TN: SCI-NORTH CAROLINA LTD. PARTNERSHIP · 2.8 ac · ref 10700009100 · tn-47037
- site-679db06f0e EdgeConneX Salt Lake City (EDCSLC01) (EdgeConneX Inc.) — Salt Lake County, UT: owner not published · ? ac · ref 15201010210000 · ut
- site-3f2879bf0f EdgeCore Reno 1 (EdgeCore Digital Infrastructure) — Storey County, NV: owner not published · 56.28464919 ac · ref 00507146 · nv
- site-96d8d1873c Edged Chicago ORD01 (Edged) — DuPage County, IL: EDGED CHICAGO LLC · 8.85 ac · ref 0705105006 · il-17043
- site-197fbf1c4a Element Critical CH2 (Element Critical) — DuPage County, IL: BARTO, RICK · 0.5 ac · ref 0310200021 · il-17043
- site-e9d2adef79 Encompass Minneapolis Facility (Encompass) — Anoka County, MN: Encompass Digital Media Llc · 102.13790079 ac · ref 27003-333122210003 · mn
- site-123a053b77 Energynet Datacenter (Hopkinsville Electric System) — Christian County, KY: ELECTRIC PLANT BOARD · 11.5179358451 ac · ref 226-00-01-009.00 · ky-21047
- site-88886e3491 Epic / Mayo Data Center () — Olmsted County, MN: Epic Hosting Llc · 11.0 ac · ref 27109-741741082291 · mn
- site-e84ecf938d Equinix DC8 - Ashburn, Vienna (Equinix, Inc.) — Fairfax County, VA: owner not published · ? ac · ref 390049 · va
- site-5db43b808e Equinix DE1 - Denver (Equinix, Inc.) — Arapahoe County, CO: AC CENTENNIAL LLC · ? ac · ref 2075-27-3-18-002 · co-08005
- site-9c91a5d326 Ethoplex Data Center (Ethoplex) — Washington County, WI: TECHPLEX LLC · 0.15 ac · ref GTNV 204959 · wi
- site-5d7acca239 Ethoplex Edge DC - Fond du Lac (Ethoplex) — Fond du Lac County, WI: ETHOPLEX LLC · 1.72 ac · ref T111617290500300 · wi
- site-086d0e78c1 Ethoplex Edge DC - Green Bay (Ethoplex) — Brown County, WI: ETHOPLEX, LLC · 3.89 ac · ref D-461-1 · wi
- site-d7d4964a2c Expedient Milwaukee (Wisconsin CyberLynk Network, Inc.) — Milwaukee County, WI: RDC-4777 IRONWOOD DRIVE LLC · 2.64 ac · ref 9301001000 · wi
- site-e550c0d03e Expedient Pittsburgh - Nova Place (Expedient) — Allegheny County, PA: owner not published · ? ac · ref 0008C00155000400 · pa
- site-fc03158a59 Expedient Pittsburgh South (Expedient) — Allegheny County, PA: owner not published · ? ac · ref 0018K00080000000 · pa
- site-7f24eff821 FiberState Datacenter (FIBERSTATE) — Salt Lake County, UT: owner not published · ? ac · ref 28313010380000 · ut
- site-651b9227c3 Fiberhub LAS1 (Fiberhub) — Clark County, NV: owner not published · 2.48273857 ac · ref 17703613005 · nv
- site-e2b4570056 Flexential - Salt Lake City/Cottonwood (SLC05) (Flexential Corp.) — Salt Lake County, UT: owner not published · ? ac · ref 22231270150000 · ut
- site-bba781f10d Flexential Allentown Data Center (Flexential) — Lehigh County, PA: owner not published · ? ac · ref 640842667847 · pa
- site-c44180e8b6 Flexential Atlanta - Douglasville 1 (Flexential) — Douglas County, GA: FLEXENTIAL CORP. · 24.28 ac · ref 01730150013 · ga-13097 · +1 same-owner lot(s)
- site-ff77f21e3b Flexential Atlanta - Norcross (Flexential) — Gwinnett County, GA: owner not published · 3.22 ac · ref 6256 098 · ga-13135
- site-dab1f5c587 Flexential Las Vegas - Downtown (Flexential) — Clark County, NV: owner not published · 0.7056548 ac · ref 13934210081 · nv
- site-dc40184e47 Flexential Las Vegas - North (Flexential) — Clark County, NV: owner not published · 6.39007407 ac · ref 12436811009 · nv
- site-c79f8a7b42 Flexential Louisville - Downtown (Flexential) — Jefferson County, KY: owner not published · ? ac · ref 021D00560000 · ky-21111
- site-7109592fd5 Flexential Minneapolis - Chaska (Flexential) — Carver County, MN: Flexential Llc · 28.90197294 ac · ref 27019-300590020 · mn
- site-cd68b622c8 Flexential Nashville - Cool Springs (Flexential) — Williamson County, TN: FRANKLIN TECH PARTNERS LLC · 7.66 ac · ref 053 10903 00008053 · tn-47187
- site-5059dad4bf Flexential Nashville - Franklin (Flexential) — Williamson County, TN: GLACIER DC ASSETS LLC · 8.84 ac · ref 079 04104 00009079 · tn-47187
- site-250da19fa3 Flexential Philadelphia - Collegeville (Flexential) — Montgomery County, PA: owner not published · ? ac · ref 610000175025 · pa
- site-a87d9a7be5 Flexential Salt Lake City - Downtown (Flexential) — Salt Lake County, UT: owner not published · ? ac · ref 15044520420000 · ut
- site-85c1945e41 Flexential Salt Lake City - Fair Park (Flexential) — Salt Lake County, UT: owner not published · ? ac · ref 15021330312000 · ut
- site-9b1efc8f4d Flexential Salt Lake City - Lindon (Flexential) — Utah County, UT: owner not published · ? ac · ref 402830005 · ut
- site-c4c99334d7 Flexential Salt Lake City - Millcreek (Flexential) — Salt Lake County, UT: owner not published · ? ac · ref 16313760440000 · ut
- site-b788986f74 Frontier (supercomputer) (Oak Ridge National Laboratory) — Roane County, TN: UT-BATTELLE DEVELOPMENT CORPORATION · 6.62 ac · ref 073031 00101 · tn
- site-b1a32f4e3a Fusetelecom Data Center (Fuse Telecom LLC) — Bayamón Municipio, PR: owner not published · ? ac · ref ? · pr
- site-d6d1c3a2d0 Gafachi 1 West Main Rochester (Gafachi) — Monroe County, NY: owner not published · 0 ac · ref 26140012122000010240000000 · ny-36055
- site-b8d8ee3a15 Genome Data Center (Washington University in St. Louis) — St. Louis city, MO: WASHINGTON UNIVERSITY · ? ac · ref 39049065000 · mo-29510
- site-9b08aa0fe4 George C. Wallace Alabama Supercomputer Center (Alabama Supercomputer Authority) — Madison County, AL: ALABAMA SUPERCOMPUTER AUTHORITY · 6.97 ac · ref 14-09-31-0-000-035.000 · al-01089
- site-bbd27f6ecd Golden West Rapid City Skyline Facility (Golden West Telecommunications Coop., Inc.) — Pennington County, SD: GOLDEN WEST TELECOMMUNICATIONS COOPE · 0.86 ac · ref 3714178002 · sd-46103 · +1 same-owner lot(s)
- site-710151952f H5 Data Centers Nashville (H5 Data Centers) — Davidson County, TN: HYSCALEIX DATA CENTERS NASHVILLE LAND, LLC · 0.67 ac · ref 09306109600 · tn-47037
- site-cf72f97593 H5 Data Centers Pittsburgh (PA02) (H5 Data Centers) — Allegheny County, PA: owner not published · ? ac · ref 0010A00190000000 · pa
- site-f7f326b1e3 H5 Minneapolis (H5) — Ramsey County, MN: 1house2hands Inc · 6.39 ac · ref 27123-272923140030 · mn
- site-6be5059513 HPC (Sandia National Laboratories) — Bernalillo County, NM: U S Government · 635 ac · ref 102005566466110144 · nm-35001
- site-c548e0231c HSW-DC1RH (High Speed Web, Inc.) — York County, SC: 420 DALE LYLE LLC · 0.4464 ac · ref 6271101028 · sc-45091
- site-e97fe2430f Hemlock Plaza (600Amps Internet Services, Inc.) — Curry County, OR: SNAZMART LLC · 0.34 ac · ref 4113-06DA-05700-00 · or-41015
- site-2bca43b1cd Heyburn Building (The Heyburn Building) — Jefferson County, KY: owner not published · ? ac · ref 029B00490000 · ky-21111
- site-cd6bfbe88c IRIS - Nashville (IRIS) — Davidson County, TN: PNH PROPERTIES, LLC · 0.5 ac · ref 09306203400 · tn-47037
- site-d74ddb6052 Implex Minneapolis (Implex) — Hennepin County, MN: Tc Rgnl Cbl Chan R E Hds Ltd · 0.35 ac · ref 27053-1402924230196 · mn
- site-a39377f058 Information Technology Data Center (Phillips Exeter Academy) — Rockingham County, NH: owner not published · ? ac · ref 084072-064-042-0000 · nh
- site-ef95d35a6a Iron City No. 1 Power Generator and Compute Center () — Clearfield County, PA: RIVER HILL POWER COMPANY LLC · 0.0 ac · ref 1210T0300000038 · pa-2 · +4 same-owner lot(s)
- site-b53d69a5e1 Iron Mountain Data Center - Western Pennsylvania (WPA-1) (Iron Mountain Data Centers) — Butler County, PA: owner not published · ? ac · ref 070-2F118- A5-0000 · pa
- site-c10ca88690 JSLLC Bozeman (Johnson Services, LLC.) — Gallatin County, MT: JOHNSON LIANE S · 0.31146869 ac · ref 06079907219010000 · mt
- site-158140b04b John F. Simms Building (SONM) — Santa Fe County, NM: State Of New Mexico · ? ac · ref 1053098282184000000 · nm-35049
- site-5d50d79c7d Landmax Data Systems, Inc () — Monroe County, NY: owner not published · 0.48 ac · ref 26500021311000010270000000 · ny-36055
- site-067ff9e4f2 Level(3) Boise (Lumen Technologies Inc) — Ada County, ID: owner not published · 5 ac · ref R2767200210 · id-2
- site-a88a4d660c Level(3) Herndon (Lumen Technologies Inc) — Fairfax County, VA: owner not published · ? ac · ref 29117 · va
- site-3050d5e4c7 Level(3) Memphis (Lumen Technologies Inc) — Shelby County, TN: LEVEL 3 COMMUNICATIONS LLC · ? ac · ref 073101 00830 · tn-47157
- site-2ca765ad43 Level(3) Nashville (9th Ave) (Lumen Technologies Inc) — Davidson County, TN: WILLIAMS COMMUNICATIONS, INC. · 5.59 ac · ref 08103038100 · tn-47037
- site-dbac25dd66 Level(3) Nashville (Sidco Drive) (Lumen Technologies Inc) — Davidson County, TN: LEVEL 3 COMMUNICATIONS, LLC · 5.0 ac · ref 13204000500 · tn-47037
- site-b93d39da9d LightEdge Kansas City Cavern (KCI2) (LightEdge Cavern Suites) — Johnson County, KS: owner not published · 5.19210995 ac · ref 0460830602001003010 · ks-20091
- site-521d7d32ad Lightboard ★ Vermont (Lightboard ★) — Chittenden County, VT: SOUTH BURLINGTON CITY OF · 9.16 ac · ref 600-188-15489 · vt
- site-9ac96609d9 Lincoln Rackhouse (Lincoln Rackhouse) — DuPage County, IL: US SIGNAL PROP AURORA LLC · 5.25 ac · ref 0716303001 · il-17043
- site-f0bcb006f0 Lincoln Rackhouse Atlanta (Lincoln Rackhouse) — DeKalb County, GA: BBK COKE DATA CENTER LLC · 12.77 ac · ref 18 346 05 076 · ga-13089
- site-a5cdf9c36d Liquid Web () — Eaton County, MI: LMRK DI PROPCO LLC · 1.8102092 ac · ref 04008480003100 · mi-26045
- site-82fb7965c4 Liquid Web, Inc (CMN-RUS, Inc. d/b/a Metronet) — Eaton County, MI: LMRK DI PROPCO LLC · 5.31885206 ac · ref 04002820006000 · mi-26045 · +1 same-owner lot(s)
- site-c629d239d1 LogInToUs, Inc. (Nicholas J Brockway) — Franklin County, NY: Alice Hyde Medical Center · 0.61000001 ac · ref 98.57-2-2 · ny-36033
- site-d6f324f400 Lost River Data Center (Western Kentucky University) — Warren County, KY: WESTERN KENTUCKY UNIVERSITY · 10.50434875 ac · ref 041B-02 · ky-21227
- site-25cad56da6 Lowest Host/Empire Technology (Lowest Host/Empire Technology LLC) — Salt Lake County, UT: owner not published · ? ac · ref 08223550070000 · ut
- site-f6c6b8c04d Lumen (Lumen Technologies) — Maricopa County, AZ: DI ASSETCO 2 LLC · ? ac · ref 11825126 · az-04013
- site-fcc4119b9e Lumen (Lumen Technologies) — Washington County, UT: owner not published · ? ac · ref SG-5-3-9-4247-SA · ut
- site-b386ff9b41 Lumen Boston (Lumen Technologies Inc) — Middlesex County, MA: LOHNES, TRUSTEE PAUL R. · 0.95 ac · ref 31-21 · ma
- site-84b143eb8a Lumen Madison 1 Data Center (Lumen Technologies) — Dane County, WI: KW DELTA LLC · 0.58 ac · ref 070923406148 · wi · +1 same-owner lot(s)
- site-6c1f979458 Lumen Minneapolis 3 (Lumen Technologies) — Hennepin County, MN: 715 North Second Fee Owner · 0.59 ac · ref 27053-2202924120791 · mn · +1 same-owner lot(s)
- site-1eecfe7c64 Lumen Norristown (Lumen Technologies) — Montgomery County, PA: owner not published · ? ac · ref 430004831543 · pa
- site-dc9fa042d2 Lumen Pittsburgh (Lumen Technologies Inc) — Allegheny County, PA: owner not published · ? ac · ref 0012S00330000000 · pa
- site-182fa0970a MI Tech - Main Campus (Michigan Technological University) — Houghton County, MI: STATE OF MICHIGAN FOR M T U · ? ac · ref 052-527-003-00 · mi-26061
- site-5627589a6e ManagedWay BYK1 (ManagedWay Company) — Kent County, MI: 76 BUSINESS COMPLEX LLC · 6.56216562 ac · ref 41-21-13-100-090 · mi-26081
- site-457c790e5f ManagedWay SFJ1 (ManagedWay Company) — Oakland County, MI: owner not published · ? ac · ref 2426101007 · mi-26125
- site-e057adf0ca ManagedWay TYM1 (ManagedWay Company) — Oakland County, MI: owner not published · ? ac · ref 2036376019 · mi-26125
- site-decda667e5 Midco Fargo (Midcontinent Communications) — Cass County, ND: owner not published · 4.16546054 ac · ref 38017-1-8150-00100-000 · nd
- site-e9668af9ee Midco Grand Forks (Midcontinent Communications) — Grand Forks County, ND: owner not published · 2.00083666 ac · ref 38035-44124000004005 · nd
- site-9585ae5778 Midco Sioux Falls (Midcontinent Communications) — Lincoln County, SD: MIDCONTINENT COMMUNICATIONS · 1.44 ac · ref 280.58.02.010C · sd-46083-siouxfalls · +1 same-owner lot(s)
- site-eafd67294c Midco Yankton (Midcontinent Communications) — Yankton County, SD: YANKTON THRIVE INC · 0 ac · ref 78.990.012.271 · sd-46135
- site-bcdbbceb7c Midcon Recovery Solutions B3 Data Center (Midcon Recovery Solutions) — Oklahoma County, OK: MORIAH AVAYA LLC · 5.915 ac · ref R140736070 · ok-40109
- site-5103f60b0d Midwest Energy & Communications (Midwest Energy & Communications) — Cass County, MI: MIDWEST ENERGY & COMMUNICATION · 151.41 ac · ref 14-100-030-001-10 · mi-26027 · +6 same-owner lot(s)
- site-b63b0d1f38 Molina Healthcare (Molina Healthcare) — Bernalillo County, NM: Molina Healthcare Data Center Inc · 2.5194 ac · ref 101605111235520815 · nm-35001
- site-b2a606819d Montana Opticom (Montana Opticom LLC) — Gallatin County, MT: MONTANA OPTICOM LLC · 3.26672333 ac · ref 06079711422090000 · mt
- site-1e99fa5118 Morgan Wireless () — Morgan County, WV: JGM PROPERTY LLC · 0.16751307 ac · ref 33-03-0001-0021-0000 · wv
- site-b443b8e362 Mountain West Technologies - Casper (Mountain West Technologies Corporation) — Natrona County, WY: owner not published · 0 ac · ref 33790910701000 · wy
- site-aef9878273 Mountain West Technologies - Cheyenne (Mountain West Technologies Corporation) — Laramie County, WY: 6101 YELLOWSTONE LLC · 11.99 ac · ref 14661832300200 · wy
- site-41bea9d81c NCSA Petascale Computing Facility () — Champaign County, IL: BD OF TRUS OF THE U OF I · 33.05 ac · ref 452024276062 · il-17019-uiuc · +40 same-owner lot(s)
- site-c2fb283cc1 NP Belle Plaine (MSP1) (Neutral Path Communications, LLC) — Scott County, MN: Zayo Group Llc · 0.12 ac · ref 27139-200660081 · mn
- site-04034de612 NP Rochester (Neutral Path Communications, LLC) — Olmsted County, MN: Center Plaza Association of Rochester · 0.0 ac · ref 27109-640211080524 · mn · +1 same-owner lot(s)
- site-f117cdbe6f Nautilus Cryptomine () — Luzerne County, PA: AMAZON DATA SERVICES INC · ? ac · ref 55O4 00A101000 · pa-42079 · +20 same-owner lot(s)
- site-595e97dcae Netrality Data Centers (Netrality Data Centers) — St. Louis city, MO: 210 N TUCKER OWNER LLC · ? ac · ref 05039141021 · mo-29510
- site-4260b88107 Netrality Kansas City Metro – KC2 | 7801 Nieman (Netrality Data Centers) — Johnson County, KS: owner not published · 10.98445289 ac · ref 0460562304004004000 · ks-20091
- site-34ca3c83ce Omega PA1 (Omega Systems Consultants, LLC) — Berks County, PA: owner not published · ? ac · ref 80438719612910 · pa
- site-8a008fd590 OneNet OSU Tulsa (Oklahoma State Regents for Higher Education) — Tulsa County, OK: BOARD OF REGENTS FOR THE OKLAHOMA · 13.655 ac · ref 43710023602275 · ok-40143
- site-a6b58d7097 Oso Grande (Oso Grande) — Bernalillo County, NM: Oso Grande Technologies Inc · 3.6505 ac · ref 101405811719833804 · nm-35001 · +1 same-owner lot(s)
- site-98cbf5a999 PDC3 - 3949 Schelden Cir (Colocation America Corporation) — Northampton County, PA: OMEGA ASSETS L P · 4.21 ac · ref M6 15 63 0214 · pa-2
- site-6ead65517e PTC (Stayton Cooperative Telephone Company) — Linn County, OR: owner not published · 0.0 ac · ref 09S02E19BD02900 · or-41043
- site-b05c255236 Parsec Data Management (Parsec Data Management, Inc) — Yellowstone County, MT: NEMONT COMMUNICATIONS INC · 1.62367987 ac · ref 03092614435010000 · mt · +1 same-owner lot(s)
- site-8c3f27086f Peace Communications CHA1 (Peace Communications) — Hamilton County, TN: PPH & E PROPERTIES LLC · ? ac · ref 146I C 003 · tn-47065
- site-0078f5c472 Peace Communications HSV1 (Peace Communications) — Madison County, AL: PPH&E OF ALABAMA LLC · 0.47 ac · ref 17-01-11-4-000-035.000 · al-01089
- site-52d83d92b7 Peace Communications NSH2 (Peace Communications (Formerly Nexus Group)) — Davidson County, TN: BAC/CB FULCRUM, LLC · 10.57 ac · ref 13500035200 · tn-47037
- site-0384b836dc Peak Internet (Peak Internet, LLC) — Benton County, OR: OREGON STATE UNIVERSITY FOUNDATION · ? ac · ref 12503AD05500 · or-41003-2
- site-d28707b563 Percheron DC (Rowan Green Data LLC) — Morrow County, OR: owner not published · 274.09 ac · ref 2503.00N24.00E0000--000000123 · or-41049
- site-4861621611 Pewaukee Data Center (WE Energies) — Waukesha County, WI: WISCONSIN ELECTRIC POWER CO · 13.11 ac · ref PWC 0955990 · wi
- site-da6edac3a9 Prov.net PVD1 (1155 Westminster) (Provdotnet LLC) — Providence County, RI: owner not published · 0.11027761 ac · ref PR 032-0420-0000 · ri
- site-3280745a7d QTS (Quality Technology Services) — Fayette County, GA: owner not published · 138.2 ac · ref 0713 139 · ga-13113
- site-a81983b21e QTS (Quality Technology Services) — Fayette County, GA: owner not published · 82.46 ac · ref 0704 050 · ga-13113
- site-b49473d162 QTS (Quality Technology Services) — Fayette County, GA: owner not published · 138.2 ac · ref 0713 139 · ga-13113
- site-3912b9caf4 QTS Charlotte (CTL1) (QTS Realty Trust, Inc.) — York County, SC: QTS YORK 1 LLC · 391.293 ac · ref 4900000053 · sc-45091 · +8 same-owner lot(s)
- site-554e4c6fe5 QTS Jersey City (JCY1) (QTS Realty Trust, Inc.) — Hudson County, NJ: owner not published · 1.892997102931954 ac · ref 0906_12902_1 · nj-34017
- site-81c8f62609 QTS Overland Park (OVP1) (QTS Realty Trust, Inc.) — Johnson County, KS: owner not published · 3.09473807 ac · ref 0460793001019001000 · ks-20091
- site-d0c8aff65b QTS Suwanee Data Center 1 (Quality Technology Services) — Gwinnett County, GA: owner not published · 18.61 ac · ref 7194 029 · ga-13135
- site-be7e007bd6 QX.Net Lexington (QX.Net) — Fayette County, KY: owner not published · 0.39 ac · ref 13627453 · ky-21067
- site-5c2e6e06b0 Quad State Internet METRO1 Colocation (Quad State Internet LLC) — Massac County, IL: JONES BUILDING, LLC · 0 ac · ref 08-02-444-006 · il-17127
- site-e4ffdaae0c Quad State Internet PAH1 Colocation (Quad State Internet LLC) — McCracken County, KY: FIRE HORN INC · 0.16145208674 ac · ref 103-22-05-001 · ky-21145
- site-cdd1387cbd Quonix Datacenter (2401 Locust St) (Quonix Networks, Inc.) — Philadelphia County, PA: owner not published · ? ac · ref 1001333333 · pa
- site-d635a6e409 Rack59 Data Center (RACK59 Partners, LLC) — Oklahoma County, OK: 7725 RENO 1 LLC · 89.98 ac · ref R147949960 · ok-40109 · +4 same-owner lot(s)
- site-7bf12e812e Ridgeview Minnetonka (Ridgeview) — Hennepin County, MN: Jkt Properties Llc · 1.8 ac · ref 27053-0211722230051 · mn
- site-ffdd3ffa69 Rochelle Technology Center (Rochelle Municipal Utilities) — Ogle County, IL: CITY OF ROCHELLE · 5.3 ac · ref 25-17-300-023 · il-17141
- site-ed53ca5473 Rochester Colo (Rochester Colo LLC) — Monroe County, NY: owner not published · 5.05 ac · ref 26448917904000010031000000 · ny-36055
- site-6e2ec21319 SD Data Center (SD Data Center) — Brevard County, FL: Satcom Direct Inc · ? ac · ref 25 3635-RH-EE.1 · fl · +3 same-owner lot(s)
- site-46e1cf4e1b SFN IL-Peoria (South Front Networks) — Peoria County, IL: SFN REAL ESTATE LLC · 0.43 ac · ref 1428226036 · il-17143
- site-3a3da5b467 SFN MN-Albert Lea (South Front Networks) — Freeborn County, MN: LARRY J WANGEN TRUST · 0.2 ac · ref 340591280 · mn-27047 · +3 same-owner lot(s)
- site-1b008b2135 SFN MN-Rochester (South Front Networks) — Olmsted County, MN: Center Plaza Association of Rochester · 0.0 ac · ref 27109-640211080524 · mn · +1 same-owner lot(s)
- site-64bc5621cf SecureNet DC1 (SecureNet) — Kanawha County, WV: SOUTH CHARLESTON CITY OF · 0.2064935 ac · ref 20-22-0017-0025-0000 · wv
- site-8699e2617f Senawave (Senawave) — Salt Lake County, UT: owner not published · ? ac · ref 15213510140000 · ut
- site-3b1021b0b4 Serverfarm CH2 Oak Brook / Chicago (Serverfarm) — DuPage County, IL: SF CH2 LLC · 14.09 ac · ref 0626201028 · il-17043
- site-331de84ccc SimpleHelix (SimpleHelix) — Madison County, AL: SIMPLE HELIX LLC · 2.27 ac · ref 15-07-25-0-002-049.000 · al-01089 · +1 same-owner lot(s)
- site-564dfb6160 Southwest Cyberport (Southwest Cyberport, Inc.) — Bernalillo County, NM: Revex 2016-1 Llc · 5.64 ac · ref 101705945302540115 · nm-35001
- site-a9946559d4 State of Montana Data Center (State of Montana) — Custer County, MT: MONTANA STATE INDUSTRIAL SCHL · 290.31791481 ac · ref 14174035101010000 · mt · +6 same-owner lot(s)
- site-5e68b92aa0 Strata Networks (STRATA Networks) — Uintah County, UT: owner not published · ? ac · ref 050240046 · ut
- site-bf6ef103fc Subrigo DET11 (SUBRIGO CORPORATION) — Oakland County, MI: owner not published · ? ac · ref 2426101007 · mi-26125
- site-04264c78ae SupraNet Communications Madison (SupraNet Communications, Inc.) — Dane County, WI: BANKSTAR LLC · 4.87 ac · ref 070815401016 · wi
- site-7d01a3b5b4 Switch Data Center (Switch) — Douglas County, GA: DEVELOPMENT AUTH. OF DOUGLAS COUNTY ATTN COMPLIANCE · 17.48 ac · ref 08631820002 · ga-13097
- site-e419c62580 Synergy Fiber (SYNERGY BROADBAND) — Washtenaw County, MI: WATERWORKS PLAZA · 6.009 ac · ref 09-12-09-200-027 · mi-26161 · +1 same-owner lot(s)
- site-800b380f87 T5@Augusta (T5 Data Centers) — Richmond County, GA: GEORGIA POWER CO · 4.86 ac · ref 079-0-122-00-0 · ga-13245-2
- site-1e431b451e T5@Minneapolis (T5 Data Centers) — Hennepin County, MN: Clar Minneapolis Mn Llc · 2.5 ac · ref 27053-2702924140067 · mn
- site-dcedc05ede TSR Solutions Data Center (TSR Solutions, Inc.) — Milwaukee County, WI: 1547 CSR-MILWAUKEE LLC · 0.28 ac · ref 3920728000 · wi
- site-bc0f104a17 Tahoe Reno 1 (Switch) — Storey County, NV: owner not published · 33.52003481 ac · ref 00501223 · nv
- site-d54ad2fff2 Tech Vault South Burlington (Tech Vault, Inc.) — Chittenden County, VT: INVESTORS CORPORATION OF · 3.56 ac · ref 600-188-13064 · vt
- site-d0cdc404e3 Telefonica KeyCenter (Telefonica KeyCenter) — Miami-Dade County, FL: DAYTONA US PARTNERSHIP LP · ? ac · ref 2530310210013 · fl
- site-56419a8cc8 Terminal Commerce Building (Equinix, Inc.) — Philadelphia County, PA: owner not published · ? ac · ref 1001026923 · pa
- site-cddbf5d790 TierPoint (Hostirian) — St. Louis city, MO: TIERPOINT LLC · ? ac · ref 05169080000 · mo-29510 · +1 same-owner lot(s)
- site-dabd365ef0 TierPoint (TierPoint, LLC) — Tulsa County, OK: SBSW LTD · 0.4242 ac · ref 00500920131140 · ok-40143
- site-21c55400d3 TierPoint Bethlehem (TierPoint, LLC) — Northampton County, PA: BARTOLACCI RICHARD & RHONDA A · 8.23 ac · ref M6 15 10W 0214 · pa-2 · +1 same-owner lot(s)
- site-ea6442a17e TierPoint Lehigh Valley (TierPoint, LLC) — Northampton County, PA: OMEGA ASSETS L P · 4.21 ac · ref M6 15 63 0214 · pa-2
- site-b7a1666f68 TierPoint Milwaukee (TierPoint, LLC) — Milwaukee County, WI: WSP BURNHAM LLC · 1.45 ac · ref 4571008006 · wi · +1 same-owner lot(s)
- site-327a2b4181 TierPoint Oklahoma City (TierPoint, LLC) — Oklahoma County, OK: ARCHES DC ASSETS LLC · 14.99 ac · ref R145433350 · ok-40109
- site-a349b988e6 TierPoint Philadelphia (TierPoint, LLC) — Philadelphia County, PA: owner not published · ? ac · ref 1001319422 · pa
- site-884c90d47c TierPoint St. Louis - Locust (TierPoint, LLC) — St. Louis city, MO: TIERPOINT LLC · ? ac · ref 09209020000 · mo-29510
- site-9006d42ef6 TierPoint St. Louis – Millpark (TierPoint, LLC) — St. Louis County, MO: PRESTWICK MILLPARK LLC · 4.81 ac · ref 15M410102 · mo-29189
- site-ce5f7cb0aa TierPoint Valley Forge (TierPoint) — Montgomery County, PA: owner not published · ? ac · ref 430012262007 · pa
- site-acb928d847 Tonaquint Data Center - Saint George (Tonaquint Data Center, Inc.) — Washington County, UT: owner not published · ? ac · ref SG-TCTR-2-4 · ut
- site-c435727233 TriTech Center (DCI Technology Minneapolis, LLC) — Hennepin County, MN: 331 2nd Ave Finance Llc · 0.35 ac · ref 27053-2302924330685 · mn
- site-5d8fee5803 TulsaConnect (OCOSA) — Tulsa County, OK: KENNEDY TOWER LLC · 0.4821 ac · ref 00500920137100 · ok-40143
- site-38f03e829c TulsaConnect DC3 (TulsaConnect) — Tulsa County, OK: MERIT PARTNERS LLC · 97.2864 ac · ref 75400942903520 · ok-40143
- site-d7467c88c2 U.S. Bank National Data Process Center () — Johnson County, KS: owner not published · 36.62268276 ac · ref 0460920902002001000 · ks-20091
- site-08dd7f8a94 UNM Data Center (UNM) — Bernalillo County, NM: Regents Of Unm · 10.79 ac · ref 101605717651721001 · nm-35001 · +2 same-owner lot(s)
- site-b9a666a189 UPS Data Center () — Forsyth County, GA: owner not published · 24.98 ac · ref 066 001 · ga-13117
- site-e874778fe7 US Signal - Grand Rapids South (US Signal) — Kent County, MI: 76 BUSINESS COMPLEX LLC · 6.56216562 ac · ref 41-21-13-100-090 · mi-26081
- site-9e18452201 US Signal - Oak Brook (US Signal) — DuPage County, IL: SF CH2 LLC · 14.09 ac · ref 0626201028 · il-17043
- site-08b9ca0302 US Signal MN01 - Minneapolis (OneNeck IT Solutions LLC) — Hennepin County, MN: Oneneck Data Ctr Holding Llc · 3.15 ac · ref 27053-0111622430014 · mn
- site-4ffb7ed1f8 US Signal WI02 - Madison (OneNeck IT Solutions LLC) — Dane County, WI: ONENECK DATA CENTER HOLDINGS LLC · 9.97 ac · ref 060915245382 · wi
- site-3cde5bb7c3 University of Oregon (University of Oregon) — Lane County, OR: State of OR Acting Thru Bd of TR Univ of OR · 128.75563895 ac · ref 1703320000100 · or-41039
- site-2447dcc503 University of Wisconsin-Madison (University of Wisconsin-Madison) — Dane County, WI: UNIV OF WIS REGENTS RE DEV & ADMIN UW MADISON · 1.46 ac · ref 070922107119 · wi
- site-3fc385f22d VELCO Rutland (Vermont Electric Power Company, Inc.) — Rutland County, VT: VERMONT TRANSCO LLC · 57.49 ac · ref 543-171-12048 · vt
- site-776b239809 VISA (VISA) — Lake County, IL: HSBC TECHNOLOGY & SERVICES USA INC · 2.55991721 ac · ref 1509402001 · il-17097
- site-deb5c765cc Vaultas (Vaultas, Inc.) — Milwaukee County, WI: GRAND CENTRAL FARMS LLC · 0.74 ac · ref 3922562100 · wi
- site-baca3426c6 Verizon () — Salt Lake County, UT: owner not published · ? ac · ref 27011760130000 · ut
- site-bf6d3af348 Verizon North Las Vegas (Verizon) — Clark County, NV: owner not published · 1.75718084 ac · ref 13910310012 · nv
- site-bbaf8c734f Voonami SLC1 (Voonami, Inc.) — Utah County, UT: owner not published · ? ac · ref 532290003 · ut
- site-d5c9ecd9d6 Voonami SLC2 (Voonami, Inc.) — Salt Lake County, UT: owner not published · ? ac · ref 15201010210000 · ut
- site-5a409cc72a WANSEC DC16 (WANSecurity, Inc.) — Johnson County, KS: owner not published · 0.78639569 ac · ref 0460573503001009010 · ks-20091
- site-0e8cd84fac Westelcom Networks Plattsburgh (Westelcom Networks) — Clinton County, NY: 24 MARGARET STREET LLC · 0 ac · ref 207.82-1-16 · ny-36019
- site-18f067432d Westelcom Networks Watertown (Westelcom Networks) — Jefferson County, NY: Westelcom Clec Inc · ? ac · ref 10-01-316.000 · ny-36045
- site-25875605ff Windbreak Cable () — Laramie County, WY: owner not published · 0 ac · ref 14601510500600 · wy
- site-5baceb49df Windstream () — Tulsa County, OK: 110 W 7TH LLC · 2.0661 ac · ref 08360920112370 · ok-40143
- site-277c7fde0e WēConnect Westerville (City of Westerville) — Franklin County, OH: CITY OF WESTERVILLE · 1.39752806 ac · ref 080-011573 · oh
- site-d62acd382c XO Nashville (XO) — Davidson County, TN: CBR 300 2ND AVENUE, LLC · 0.67 ac · ref 09306004000 · tn-47037 · +1 same-owner lot(s)
- site-5304b010d4 XO Salt Lake City IP PoP (Verizon Communications, Inc.) — Salt Lake County, UT: owner not published · ? ac · ref 15081760090000 · ut
- site-aa23864b16 YRIX (YRIX) — Yellowstone County, MT: FAGG FAMILY PROPERTIES LLC · 0.92593745 ac · ref 03092703219020000 · mt
- site-243576ba00 Zayo Nashville - 209 10th Ave. S (Zayo Group) — Davidson County, TN: CUMMINS STATION, L.L.C. · 2.38 ac · ref 09309032000 · tn-47037
- site-501680f09d Zayo Pittsburgh - 2500 Allegheny Center Mall (Zayo Group) — Allegheny County, PA: owner not published · ? ac · ref 0008C00128000000 · pa
- site-b55aeedb8a aspStation, Inc. (aspStation, Inc.) — Allegheny County, PA: owner not published · ? ac · ref 0050J00105000000 · pa
- site-317fff469d iConnect Billings Fiber Hotel (iConnect Montana) — Yellowstone County, MT: FAGG FAMILY PROPERTIES LLC · 0.92593745 ac · ref 03092703219020000 · mt
- site-031b7a373a iConnect Missoula (iConnect Montana) — Missoula County, MT: CCM LLC · 0.15905609 ac · ref 04220022230030000 · mt
- site-c255b91cdb xAI Colossus (xAI) — Shelby County, TN: PHOENIX MEMPHIS IV INDUSTRIAL INVESTORS · ? ac · ref 050101 00076 · tn-47157 · +1 same-owner lot(s)

## Still without a recorded boundary (36 sites)

### A layer covers the county and found no parcel at the dot (16)

The point sits on a road, a gap between lots, or the wrong place altogether. Each is a placement question before it is a parcel question; the AI sites are listed with the layer(s) that answered, the rest counted by state.

- **site-8f472304c0** Colossus 1 (SpaceXAI) — Shelby County, TN · 35.073554, -90.087308 · asked: tn-47157, tn
- **site-9364e38e2c** Microsoft Fairwater Atlanta (Microsoft) — Fayette County, GA · 33.445223, -84.524826 · asked: ga-13113
- others: NE 2, MI 1, AK 1, CO 1, OH 1, FL 1, IN 1, NY 1, TX 1, NJ 1, TN 1, IL 1, PA 1

### No layer covers the county (20)

The counties in `data/review/parcel_layers_review.md` with no public parcel service, plus any the sweep missed.

- **site-37c730e006** CoreWeave Muskogee OK (CoreWeave) — Muskogee County, OK
- **site-a8a83c22fe** Google Pryor (North) (Google) — Mayes County, OK
- **site-f3e3864878** Justified Data Campus (TeraWulf) — Hancock County, KY
- **site-22272a15bc** Meta Hyperion (Meta) — Richland Parish, LA
- others: Platte County, MO (4); Jackson County, MO (3); Clay County, MO (2); Madison County, IL (1); Muskogee County, OK (1); Caldwell County, MO (1); Bryan County, OK (1); Floyd County, KY (1); Cherokee County, OK (1); Logan County, KY (1)
