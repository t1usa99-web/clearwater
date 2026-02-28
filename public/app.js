/* ═══════════════════════════════════════════════════════════════
   ClearWater - Frontend Application
   ═══════════════════════════════════════════════════════════════ */

'use strict';

// ─── State ──────────────────────────────────────────────────────
const state = {
  view: 'search',
  zip: '',
  systems: [],
  selectedSystem: null,
  report: null,
};

// ─── EPA Contaminant Database ────────────────────────────────────
// Maps contaminant codes to names, health info, and MCL values
const CONTAMINANTS = {
  '0001': { name: 'Fluoride',                   mcl: 4.0,     unit: 'mg/L',  cat: 'Inorganic',       health: 'At high levels, can cause dental and skeletal fluorosis. Most water systems add fluoride for dental health.' },
  '0002': { name: 'Arsenic',                    mcl: 0.010,   unit: 'mg/L',  cat: 'Inorganic',       health: 'Long-term exposure linked to skin damage, circulatory problems, and increased cancer risk. Occurs naturally in rock and soil.' },
  '0003': { name: 'Barium',                     mcl: 2,       unit: 'mg/L',  cat: 'Inorganic',       health: 'Elevated levels may increase blood pressure. Found naturally in rock and used industrially.' },
  '0004': { name: 'Cadmium',                    mcl: 0.005,   unit: 'mg/L',  cat: 'Inorganic',       health: 'Kidney damage from long-term exposure. Comes from galvanized pipe corrosion and industrial discharge.' },
  '0005': { name: 'Chromium',                   mcl: 0.1,     unit: 'mg/L',  cat: 'Inorganic',       health: 'Allergic dermatitis. Occurs naturally and from industrial discharges.' },
  '0006': { name: 'Lead',                       mcl: 0.015,   unit: 'mg/L',  cat: 'Heavy Metal',     health: 'Serious brain and nervous system damage, especially in children and fetuses. Usually enters water from old pipes and fixtures, not the source water itself.' },
  '0007': { name: 'Mercury (inorganic)',        mcl: 0.002,   unit: 'mg/L',  cat: 'Heavy Metal',     health: 'Kidney damage from long-term exposure. Enters water from industrial waste and natural deposits.' },
  '0008': { name: 'Nitrate',                    mcl: 10,      unit: 'mg/L',  cat: 'Inorganic',       health: 'Serious blood disorder (methemoglobinemia/"blue baby syndrome") in infants under 6 months. Less risk for adults. Common from fertilizer and septic runoff.' },
  '0009': { name: 'Nitrite',                    mcl: 1,       unit: 'mg/L',  cat: 'Inorganic',       health: 'Same concern as nitrate, dangerous for infants. Short-term exposure is the main risk.' },
  '0010': { name: 'Selenium',                   mcl: 0.05,    unit: 'mg/L',  cat: 'Inorganic',       health: 'Hair and fingernail loss, numbness in extremities. Found naturally and in mining/industrial discharge.' },
  '0011': { name: 'Silver',                     mcl: 0.1,     unit: 'mg/L',  cat: 'Inorganic',       health: 'Skin discoloration (argyria). From mining, natural deposits, and industrial uses.' },
  '0012': { name: 'Antimony',                   mcl: 0.006,   unit: 'mg/L',  cat: 'Inorganic',       health: 'Nausea, vomiting, and increased blood cholesterol. From industrial chemicals and natural deposits.' },
  '0013': { name: 'Beryllium',                  mcl: 0.004,   unit: 'mg/L',  cat: 'Inorganic',       health: 'Intestinal lesions. Discharge from metal refineries and aerospace industries.' },
  '0014': { name: 'Cyanide',                    mcl: 0.2,     unit: 'mg/L',  cat: 'Inorganic',       health: 'Nerve damage and thyroid problems. From steel and plastics factories, fertilizer production.' },
  '0015': { name: 'Nickel',                     mcl: 0.1,     unit: 'mg/L',  cat: 'Inorganic',       health: 'Allergic dermatitis. Metal industries and natural deposits.' },
  '0016': { name: 'Thallium',                   mcl: 0.002,   unit: 'mg/L',  cat: 'Inorganic',       health: 'Hair loss, changes in blood and kidneys, intestines, and liver. Leaching from ore-processing and electronics. Rare.' },
  // Inorganic aliases - SDWIS violation table uses 1xxx codes for the same inorganic contaminants
  '1010': { name: 'Arsenic',                    mcl: 0.010,   unit: 'mg/L',  cat: 'Inorganic',       health: 'Long-term exposure linked to skin damage, circulatory problems, and increased cancer risk. Occurs naturally in rock and soil.' },
  '1017': { name: 'Beryllium',                  mcl: 0.004,   unit: 'mg/L',  cat: 'Inorganic',       health: 'Intestinal lesions. Discharge from metal refineries and aerospace industries.' },
  '1020': { name: 'Cadmium',                    mcl: 0.005,   unit: 'mg/L',  cat: 'Inorganic',       health: 'Kidney damage from long-term exposure. Comes from galvanized pipe corrosion and industrial discharge.' },
  '1025': { name: 'Chromium',                   mcl: 0.1,     unit: 'mg/L',  cat: 'Inorganic',       health: 'Allergic dermatitis. Occurs naturally and from industrial discharges.' },
  '1030': { name: 'Fluoride',                   mcl: 4.0,     unit: 'mg/L',  cat: 'Inorganic',       health: 'At high levels, can cause dental and skeletal fluorosis. Most water systems add fluoride for dental health.' },
  '1035': { name: 'Mercury (inorganic)',        mcl: 0.002,   unit: 'mg/L',  cat: 'Heavy Metal',     health: 'Kidney damage from long-term exposure. Enters water from industrial waste and natural deposits.' },
  '1038': { name: 'Nickel',                     mcl: 0.1,     unit: 'mg/L',  cat: 'Inorganic',       health: 'Allergic dermatitis. Metal industries and natural deposits.' },
  '1045': { name: 'Selenium',                   mcl: 0.05,    unit: 'mg/L',  cat: 'Inorganic',       health: 'Hair and fingernail loss, numbness in extremities. Found naturally and in mining/industrial discharge.' },
  '1050': { name: 'Antimony',                   mcl: 0.006,   unit: 'mg/L',  cat: 'Inorganic',       health: 'Nausea, vomiting, and increased blood cholesterol. From industrial chemicals and natural deposits.' },
  '1055': { name: 'Arsenic',                    mcl: 0.010,   unit: 'mg/L',  cat: 'Inorganic',       health: 'Long-term exposure linked to skin damage, circulatory problems, and increased cancer risk. Occurs naturally in rock and soil.' },
  '1060': { name: 'Barium',                     mcl: 2,       unit: 'mg/L',  cat: 'Inorganic',       health: 'Elevated levels may increase blood pressure. Found naturally in rock and used industrially.' },
  '1065': { name: 'Thallium',                   mcl: 0.002,   unit: 'mg/L',  cat: 'Inorganic',       health: 'Hair loss, changes in blood and kidneys, intestines, and liver. Leaching from ore-processing and electronics. Rare.' },
  '1074': { name: 'Cyanide',                    mcl: 0.2,     unit: 'mg/L',  cat: 'Inorganic',       health: 'Nerve damage and thyroid problems. From steel and plastics factories, fertilizer production.' },
  '1076': { name: 'Nitrate',                    mcl: 10,      unit: 'mg/L',  cat: 'Inorganic',       health: 'Serious blood disorder in infants under 6 months ("blue baby syndrome"). Less risk for adults. Common from fertilizer and septic runoff.' },
  '1077': { name: 'Nitrite',                    mcl: 1,       unit: 'mg/L',  cat: 'Inorganic',       health: 'Same concern as nitrate, dangerous for infants under 6 months. Short-term exposure is the main risk.' },
  '1024': { name: 'Cyanide',                    mcl: 0.2,     unit: 'mg/L',  cat: 'Inorganic',       health: 'Nerve damage and thyroid problems. From steel and plastics factories, fertilizer production.' },
  '1028': { name: 'Iron',                       mcl: 0.3,     unit: 'mg/L',  cat: 'Inorganic',       health: 'Not a primary health standard; regulated for aesthetics. High iron causes rusty color, metallic taste, and staining. Found naturally in groundwater.' },
  '1032': { name: 'Manganese',                  mcl: 0.05,    unit: 'mg/L',  cat: 'Inorganic',       health: 'Secondary aesthetic standard for taste and staining. Emerging research suggests long-term exposure above 0.3 mg/L may affect neurological development in children, though the primary MCL has not yet been set.' },
  '1036': { name: 'Nickel',                     mcl: 0.1,     unit: 'mg/L',  cat: 'Inorganic',       health: 'Allergic dermatitis. Metal industries and natural deposits.' },
  '1041': { name: 'Nitrite',                    mcl: 1,       unit: 'mg/L',  cat: 'Inorganic',       health: 'Same concern as nitrate, dangerous for infants under 6 months. Short-term exposure is the main risk.' },
  '1052': { name: 'Sodium',                     mcl: null,    unit: 'mg/L',  cat: 'Inorganic',       health: 'No federal MCL. Systems serving sensitive populations (people on low-sodium diets) must notify if levels exceed 20 mg/L. Sodium in water is rarely a health concern for most people.' },
  '1075': { name: 'Beryllium',                  mcl: 0.004,   unit: 'mg/L',  cat: 'Inorganic',       health: 'Intestinal lesions. Discharge from metal refineries and aerospace industries.' },
  '1085': { name: 'Thallium',                   mcl: 0.002,   unit: 'mg/L',  cat: 'Inorganic',       health: 'Hair loss, changes in blood and kidneys, intestines, and liver. Leaching from ore-processing and electronics. Rare.' },
  '1915': { name: 'Total Hardness',             mcl: null,    unit: 'mg/L',  cat: 'Inorganic',       health: 'Not a regulated contaminant. Hard water (high calcium and magnesium) is not a health risk, but can cause scale buildup in pipes and appliances and affect soap lathering.' },
  '1095': { name: 'Lead',                       mcl: 0.015,   unit: 'mg/L',  cat: 'Heavy Metal',     health: 'Serious brain and nervous system damage, especially in children and fetuses. Usually enters water from old pipes and fixtures, not the source water itself.' },
  '1100': { name: 'Copper',                     mcl: 1.3,     unit: 'mg/L',  cat: 'Heavy Metal',     health: 'Copper can cause short-term gastrointestinal distress. Long-term exposure can cause liver and kidney damage. Usually comes from home plumbing.' },
  '1001': { name: 'Benzene',                    mcl: 0.005,   unit: 'mg/L',  cat: 'Volatile Organic', health: 'Anemia and immune system damage; known human carcinogen. From factories, gas stations, underground fuel storage.' },
  '1002': { name: 'Carbon Tetrachloride',       mcl: 0.005,   unit: 'mg/L',  cat: 'Volatile Organic', health: 'Liver problems and increased cancer risk. From industrial chemical use.' },
  '1003': { name: 'Chlorobenzene',              mcl: 0.1,     unit: 'mg/L',  cat: 'Volatile Organic', health: 'Liver and kidney effects. Discharge from chemical and agricultural chemical factories.' },
  '1005': { name: 'Total Trihalomethanes (TTHMs)', mcl: 0.080, unit: 'mg/L', cat: 'Disinfection Byproduct', health: 'Increased risk of cancer with long-term exposure. Formed when chlorine disinfectants react with naturally occurring organic matter in water.' },
  '1006': { name: 'Haloacetic Acids (HAA5)',    mcl: 0.060,   unit: 'mg/L',  cat: 'Disinfection Byproduct', health: 'Increased risk of cancer. Like TTHMs, formed as a byproduct of water chlorination.' },
  '1007': { name: '1,2-Dichloroethane',         mcl: 0.005,   unit: 'mg/L',  cat: 'Volatile Organic', health: 'Increased cancer risk. Industrial chemical discharge.' },
  '1015': { name: 'Tetrachloroethylene (PCE)',  mcl: 0.005,   unit: 'mg/L',  cat: 'Volatile Organic', health: 'Liver problems and increased cancer risk. Discharge from dry cleaners and auto shops.' },
  '1016': { name: 'Toluene',                    mcl: 1,       unit: 'mg/L',  cat: 'Volatile Organic', health: 'Nervous system, kidney, or liver problems. Discharge from petroleum factories.' },
  '1021': { name: 'Trichloroethylene (TCE)',    mcl: 0.005,   unit: 'mg/L',  cat: 'Volatile Organic', health: 'Liver problems and increased cancer risk. Discharge from metal degreasing sites and other factories.' },
  '1022': { name: 'Vinyl Chloride',             mcl: 0.002,   unit: 'mg/L',  cat: 'Volatile Organic', health: 'Increased cancer risk. Leaching from PVC pipes; discharge from plastics factories.' },
  '2000': { name: 'Alachlor (herbicide)',       mcl: 0.002,   unit: 'mg/L',  cat: 'Pesticide',        health: 'Eye, liver, kidney, or spleen problems; anemia; increased cancer risk. Runoff from herbicide use on row crops.' },
  '2001': { name: 'Atrazine',                   mcl: 0.003,   unit: 'mg/L',  cat: 'Pesticide',        health: 'Cardiovascular system or reproductive problems. Widely used herbicide, runoff from crops.' },
  '2050': { name: 'Total Coliform',             mcl: 0,       unit: 'presence', cat: 'Microbial',     health: 'Coliform bacteria indicate water may be contaminated with disease-causing organisms. Stomach and intestinal illness may result.' },
  '2051': { name: 'Fecal Coliform / E. coli',   mcl: 0,       unit: 'presence', cat: 'Microbial',     health: 'Indicates the possible presence of fecal contamination. Can cause serious gastrointestinal illness.' },
  '2049': { name: 'E. coli',                    mcl: 0,       unit: 'presence', cat: 'Microbial',     health: 'Fecal contamination indicator. Gastrointestinal illness risk; especially dangerous for immunocompromised individuals.' },
  '3100': { name: 'Turbidity',                  mcl: 1,       unit: 'NTU',   cat: 'Physical',         health: 'High turbidity can interfere with disinfection and indicate the presence of contaminants. May cause stomach or gut illness.' },
  // Physical / secondary water quality parameters (corrosion control and operational monitoring)
  '0999': { name: 'Water Quality Parameter (SWTR)',  mcl: null,    unit: 'varies', cat: 'Treatment Technique', health: 'A surface water treatment monitoring parameter. Violations indicate required operational testing was not performed or reported under the Surface Water Treatment Rule.' },
  '1064': { name: 'Inorganic Chemical (Phase V)',    mcl: null,    unit: 'mg/L',   cat: 'Inorganic',           health: 'A Phase V inorganic contaminant required to be monitored under EPA rules. This violation indicates required testing was missed. Contact your utility for details on the specific chemical.' },
  '1919': { name: 'Calcium',                        mcl: null,    unit: 'mg/L',   cat: 'Secondary Standard',  health: 'Calcium is a component of water hardness and is not a health concern. Monitored for corrosion control and distribution system stability. No federal MCL.' },
  '1925': { name: 'pH',                             mcl: null,    unit: 'pH',     cat: 'Treatment Technique', health: 'pH monitoring is required for corrosion control and Lead and Copper Rule compliance. Low pH causes pipes to leach lead and copper. No federal MCL, but systems must maintain proper pH levels.' },
  '1927': { name: 'Total Alkalinity',               mcl: null,    unit: 'mg/L',   cat: 'Secondary Standard',  health: 'Total alkalinity measures the water\'s ability to neutralize acids, affecting corrosion potential. Higher alkalinity reduces risk of lead and copper leaching from pipes. No federal health-based limit.' },
  '1996': { name: 'Temperature',                    mcl: null,    unit: '\u00b0C', cat: 'Secondary Standard',  health: 'Water temperature affects corrosion rates and microbial growth potential. Monitored as part of routine water quality assessment. No federal MCL.' },
  '8000': { name: 'Surface Water Treatment (IESWTR)', mcl: null,  unit: 'TT',     cat: 'Treatment Technique', health: 'Treatment technique compliance under the Interim Enhanced Surface Water Treatment Rule. Requires filtration and disinfection to reduce Cryptosporidium, Giardia, and viruses in surface water supplies.' },
  // Turbidity monitoring codes - SDWIS uses different codes for the same parameter under different rules
  '0700': { name: 'Turbidity',                  mcl: 0.3,     unit: 'NTU',   cat: 'Physical',         health: 'A measure of water clarity. Cloudy or murky water can harbor pathogens and interfere with disinfection. Monitored under the Surface Water Treatment Rule. Must stay below 0.3 NTU in filtered systems.' },
  '0800': { name: 'Turbidity (LT1ESWTR)',       mcl: 0.3,     unit: 'NTU',   cat: 'Physical',         health: 'Combined filter effluent turbidity monitored under the Long-Term 1 Enhanced Surface Water Treatment Rule. Must remain below 0.3 NTU. Failure indicates filtration may not be removing pathogens effectively.' },
  '4010': { name: 'Chloramines (as Cl₂)',       mcl: 4,       unit: 'mg/L',  cat: 'Disinfectant',     health: 'Eye and nose irritation, stomach discomfort, anemia at very high levels. Used as a water disinfectant.' },
  '4020': { name: 'Chlorine (as Cl₂)',          mcl: 4,       unit: 'mg/L',  cat: 'Disinfectant',     health: 'Eye and nose irritation, stomach discomfort at high levels. Intentionally added for disinfection.' },
  '4030': { name: 'Chlorine Dioxide (as ClO₂)', mcl: 0.8,     unit: 'mg/L',  cat: 'Disinfectant',     health: 'Anemia and nervous system effects in infants and young children. Used as an alternative disinfectant.' },
  '7000': { name: 'Combined Radium (226 & 228)', mcl: 5,      unit: 'pCi/L', cat: 'Radionuclide',     health: 'Increased cancer risk with long-term exposure. Occurs naturally in some rock formations.' },
  '7001': { name: 'Radium-226',                  mcl: null,   unit: 'pCi/L', cat: 'Radionuclide',     health: 'Part of combined radium standard. Occurs naturally; increased cancer risk.' },
  '7002': { name: 'Radium-228',                  mcl: null,   unit: 'pCi/L', cat: 'Radionuclide',     health: 'Part of combined radium standard. Occurs naturally; increased cancer risk.' },
  '7500': { name: 'Uranium',                    mcl: 0.030,   unit: 'mg/L',  cat: 'Radionuclide',     health: 'Kidney toxicity and increased cancer risk. Occurs naturally in rock and soil.' },
  '7501': { name: 'Gross Alpha Activity',       mcl: 15,      unit: 'pCi/L', cat: 'Radionuclide',     health: 'Increased cancer risk from radioactive particles. Naturally occurring in some groundwater.' },
  '7502': { name: 'Beta/Photon Emitters',       mcl: 4,       unit: 'mrem/yr', cat: 'Radionuclide',   health: 'Increased cancer risk. Can be naturally occurring or from industrial or nuclear sources.' },
  // Stage 2 Disinfection Byproducts Rule (D/DBP) - different codes from Phase I
  '2950': { name: 'Total Trihalomethanes (TTHMs)', mcl: 0.080, unit: 'mg/L', cat: 'Disinfection Byproduct', health: 'TTHMs form when chlorine used to disinfect water reacts with natural organic matter. Long-term exposure is linked to increased cancer risk and pregnancy complications. Measured as a running annual average; short-term spikes are common.' },
  '2456': { name: 'Haloacetic Acids (HAA5)',       mcl: 0.060, unit: 'mg/L', cat: 'Disinfection Byproduct', health: 'HAA5 are disinfection byproducts formed when chlorine reacts with organic matter. Long-term exposure is associated with increased cancer risk.' },
  // Radionuclide MCL codes (rule group 300)
  '5000': { name: 'Gross Alpha Particle Activity', mcl: 15, unit: 'pCi/L', cat: 'Radionuclide', health: 'Naturally occurring radioactive particles found in some groundwater. Long-term exposure above the MCL increases cancer risk.' },
  '4000': { name: 'Gross Alpha (incl. Radium-226, excl. Radon)', mcl: 15, unit: 'pCi/L', cat: 'Radionuclide', health: 'Naturally occurring radioactivity. Long-term exposure above 15 pCi/L increases cancer risk.' },
  // Radionuclide monitoring codes
  '1040': { name: 'Gross Alpha (excl. Radon & Uranium)', mcl: 15, unit: 'pCi/L', cat: 'Radionuclide', health: 'A measure of total radioactivity from naturally occurring elements like radium and thorium in groundwater. Long-term exposure above 15 pCi/L increases cancer risk. Common in areas with granite bedrock.' },
  '5200': { name: 'Beta Particles & Photon Emitters',   mcl: 4,   unit: 'mrem/yr', cat: 'Radionuclide', health: 'A measure of radioactivity from beta-emitting isotopes (like strontium-90) and gamma radiation. Monitored under the Radionuclides Rule. Long-term exposure above 4 mrem/year increases cancer risk. Can be naturally occurring or from industrial discharge.' },
  '4100': { name: 'Gross Beta Particle Activity',       mcl: 50,  unit: 'pCi/L', cat: 'Radionuclide', health: 'Total beta radioactivity measured in drinking water. If above 50 pCi/L, individual radionuclides are identified and compared to specific limits. Naturally occurring in some groundwater; can also come from nuclear facilities.' },
  '4006': { name: 'Uranium',                            mcl: 0.030, unit: 'mg/L', cat: 'Radionuclide', health: 'Kidney toxicity and increased cancer risk from long-term exposure. Occurs naturally in certain rock formations and soil. Monitoring code used under the Radionuclides Rule.' },
  // VOC (Volatile Organic Chemical) monitoring codes - 2900s range
  '2216': { name: 'Chloroethane',                  mcl: null,    unit: 'mg/L',  cat: 'Volatile Organic', health: 'A volatile solvent used in manufacturing, as a refrigerant, and in aerosol propellants. No federal MCL currently set. Monitored under EPA\'s unregulated contaminant programs. Potential liver and nervous system effects at high levels.' },
  '2416': { name: '2,2-Dichloropropane',           mcl: null,    unit: 'mg/L',  cat: 'Volatile Organic', health: 'A halogenated organic solvent. No federal MCL currently established. Potential liver and kidney effects at elevated levels. Monitoring required under EPA\'s unregulated contaminant programs.' },
  '2959': { name: 'Xylenes (Total)',              mcl: 10,      unit: 'mg/L',  cat: 'Volatile Organic', health: 'Solvents found in gasoline, paint, and adhesives. Nervous system effects at high levels. Usually enter water from fuel spills or underground storage tank leaks.' },
  '2964': { name: 'Bromodichloromethane',         mcl: 0.080,   unit: 'mg/L',  cat: 'Disinfection Byproduct', health: 'A trihalomethane (THM) formed when chlorine reacts with natural organic matter. Regulated as part of the Total THM limit (0.080 mg/L). Long-term exposure linked to increased cancer risk.' },
  '2965': { name: 'Dibromochloromethane',         mcl: 0.080,   unit: 'mg/L',  cat: 'Disinfection Byproduct', health: 'A trihalomethane formed during chlorination. Regulated under the Total THM limit. Long-term exposure linked to cancer and reproductive effects.' },
  '2968': { name: 'Chloroform',                   mcl: 0.080,   unit: 'mg/L',  cat: 'Disinfection Byproduct', health: 'The most common trihalomethane, formed when chlorine reacts with organic matter. Regulated under the Total THM limit. Long-term exposure above limits linked to liver damage and cancer risk.' },
  '2969': { name: 'Bromoform',                    mcl: 0.080,   unit: 'mg/L',  cat: 'Disinfection Byproduct', health: 'A trihalomethane formed during chlorination in bromide-rich water. Regulated under the Total THM limit. Long-term exposure linked to cancer risk.' },
  '2976': { name: 'Benzene',                      mcl: 0.005,   unit: 'mg/L',  cat: 'Volatile Organic', health: 'A known human carcinogen that causes leukemia with long-term exposure. Enters water from fuel spills, industrial discharge, or leaking underground storage tanks.' },
  '2977': { name: 'Carbon Tetrachloride',         mcl: 0.005,   unit: 'mg/L',  cat: 'Volatile Organic', health: 'Causes liver, kidney, and nervous system damage. Increased cancer risk. Used as a solvent; enters water from industrial discharge and improper waste disposal.' },
  '2978': { name: 'Chlorobenzene',                mcl: 0.1,     unit: 'mg/L',  cat: 'Volatile Organic', health: 'Liver and kidney damage. Discharge from chemical and agricultural manufacturing.' },
  '2979': { name: 'o-Dichlorobenzene',            mcl: 0.6,     unit: 'mg/L',  cat: 'Volatile Organic', health: 'Liver, kidney, and circulatory system effects. Discharge from industrial chemical factories.' },
  '2980': { name: 'p-Dichlorobenzene',            mcl: 0.075,   unit: 'mg/L',  cat: 'Volatile Organic', health: 'Liver and kidney effects; possible cancer risk. Used in moth balls and air fresheners. Discharge from industrial facilities.' },
  '2981': { name: '1,2-Dichloroethane',           mcl: 0.005,   unit: 'mg/L',  cat: 'Volatile Organic', health: 'Increased cancer risk. Discharge from industrial chemical factories.' },
  '2982': { name: '1,1-Dichloroethylene',         mcl: 0.007,   unit: 'mg/L',  cat: 'Volatile Organic', health: 'Liver damage and increased cancer risk. Discharge from industrial chemical factories.' },
  '2983': { name: 'trans-1,2-Dichloroethylene',   mcl: 0.1,     unit: 'mg/L',  cat: 'Volatile Organic', health: 'Liver, kidney, and nervous system effects. Discharge from industrial chemical factories.' },
  '2984': { name: 'Methylene Chloride',           mcl: 0.005,   unit: 'mg/L',  cat: 'Volatile Organic', health: 'Liver damage and increased cancer risk. Used as a paint stripper and solvent; enters water from industrial discharge and landfill leaching.' },
  '2985': { name: 'cis-1,2-Dichloroethylene',     mcl: 0.07,    unit: 'mg/L',  cat: 'Volatile Organic', health: 'Liver, kidney, and nervous system effects. Discharge from industrial chemical factories.' },
  '2987': { name: 'Ethylbenzene',                 mcl: 0.7,     unit: 'mg/L',  cat: 'Volatile Organic', health: 'Liver and kidney effects. Found in gasoline; enters water from fuel spills and underground storage tank leaks.' },
  '2989': { name: 'Styrene',                      mcl: 0.1,     unit: 'mg/L',  cat: 'Volatile Organic', health: 'Liver, kidney, and circulatory system effects. Discharge from rubber and plastic factories.' },
  '2990': { name: 'Tetrachloroethylene (PERC)',   mcl: 0.005,   unit: 'mg/L',  cat: 'Volatile Organic', health: 'Liver and kidney problems; increased cancer risk. Used in dry cleaning; enters water from dry cleaning facilities and improper waste disposal.' },
  '2991': { name: 'Toluene',                      mcl: 1.0,     unit: 'mg/L',  cat: 'Volatile Organic', health: 'Nervous system, kidney, and liver effects. Found in gasoline; enters water from fuel spills and underground storage tank leaks.' },
  '2992': { name: '1,2,4-Trichlorobenzene',       mcl: 0.07,    unit: 'mg/L',  cat: 'Volatile Organic', health: 'Adrenal gland changes. Used in herbicide manufacturing; enters water from industrial discharge.' },
  '2993': { name: '1,1,1-Trichloroethane',        mcl: 0.2,     unit: 'mg/L',  cat: 'Volatile Organic', health: 'Liver, nervous system, or circulatory system problems. Discharge from metal degreasing sites and other factories.' },
  '2996': { name: 'Trichloroethylene (TCE)',      mcl: 0.005,   unit: 'mg/L',  cat: 'Volatile Organic', health: 'Liver problems and increased cancer risk. Used as a metal degreaser; enters water from industrial discharge and improper waste disposal.' },
  // SOC (Synthetic Organic Chemical / Pesticide) monitoring codes - 2000-2500s range
  '2005': { name: 'Alachlor',                     mcl: 0.002,   unit: 'mg/L',  cat: 'Pesticide',        health: 'Eye, liver, kidney, or spleen problems; anemia; increased cancer risk. Runoff from herbicide use on row crops.' },
  '2010': { name: 'Atrazine',                     mcl: 0.003,   unit: 'mg/L',  cat: 'Pesticide',        health: 'Cardiovascular and reproductive problems. Widely used herbicide; runoff from agricultural fields.' },
  '2015': { name: 'Benzo(a)pyrene',               mcl: 0.0002,  unit: 'mg/L',  cat: 'Pesticide',        health: 'Reproductive difficulties; increased cancer risk. Leaching from linings of water storage tanks and distribution lines.' },
  '2020': { name: 'Carbofuran',                   mcl: 0.04,    unit: 'mg/L',  cat: 'Pesticide',        health: 'Problems with blood, nervous system, or reproductive system. Leaching of soil fumigant used on rice and alfalfa.' },
  '2031': { name: 'Lindane',                      mcl: 0.0002,  unit: 'mg/L',  cat: 'Pesticide',        health: 'Liver or kidney problems. Historically used as an insecticide on cattle and lumber; now banned for most uses.' },
  '2035': { name: 'Endothall',                    mcl: 0.1,     unit: 'mg/L',  cat: 'Pesticide',        health: 'Stomach and intestinal problems. Herbicide used on crops and aquatic weeds.' },
  '2037': { name: 'Epichlorohydrin',              mcl: null,    unit: 'TT',    cat: 'Pesticide',        health: 'Increased cancer risk; stomach problems. Used in making epoxy resins; found in some water treatment chemicals.' },
  '2039': { name: 'Glyphosate',                   mcl: 0.7,     unit: 'mg/L',  cat: 'Pesticide',        health: 'Kidney problems; reproductive difficulties. Herbicide runoff from farm fields. MCL is conservative; levels that cause health effects are far above what is typically found in drinking water.' },
  '2040': { name: 'Methoxychlor',                 mcl: 0.04,    unit: 'mg/L',  cat: 'Pesticide',        health: 'Reproductive difficulties. Runoff from insecticide used on fruits, vegetables, and alfalfa.' },
  '2041': { name: 'Endrin',                       mcl: 0.002,   unit: 'mg/L',  cat: 'Pesticide',        health: 'Nervous system effects. Residue of banned insecticide; now rarely found in water.' },
  '2042': { name: 'Heptachlor',                   mcl: 0.0004,  unit: 'mg/L',  cat: 'Pesticide',        health: 'Liver damage; increased cancer risk. Residue of banned termiticide; now rarely found in drinking water.' },
  '2045': { name: 'Heptachlor Epoxide',           mcl: 0.0002,  unit: 'mg/L',  cat: 'Pesticide',        health: 'Liver damage; increased cancer risk. Breakdown product of heptachlor, a banned pesticide.' },
  '2065': { name: 'Dioxin (2,3,7,8-TCDD)',        mcl: 0.00000003, unit: 'mg/L', cat: 'Pesticide',      health: 'Reproductive difficulties; increased cancer risk. One of the most toxic industrial contaminants; byproduct of certain manufacturing and incineration. Its MCL is the lowest of any regulated contaminant.' },
  '2067': { name: 'Di(2-ethylhexyl) Phthalate',  mcl: 0.006,   unit: 'mg/L',  cat: 'Pesticide',        health: 'Reproductive difficulties; liver problems; increased cancer risk. Used in PVC plastics; enters water from leaching of plastic materials and industrial waste.' },
  '2070': { name: 'Picloram',                     mcl: 0.5,     unit: 'mg/L',  cat: 'Pesticide',        health: 'Liver problems; kidney or spleen damage. Herbicide runoff from fields and rights of way.' },
  '2076': { name: 'Di(2-ethylhexyl) Adipate',    mcl: 0.4,     unit: 'mg/L',  cat: 'Pesticide',        health: 'General toxic effects or reproductive difficulties. Used in PVC plastics and synthetic lubricants.' },
  '2077': { name: 'Oxamyl (Vydate)',              mcl: 0.2,     unit: 'mg/L',  cat: 'Pesticide',        health: 'Slight nervous system effects. Insecticide runoff from apple orchards and potato and tomato fields.' },
  '2110': { name: 'Carbofuran',                   mcl: 0.04,    unit: 'mg/L',  cat: 'Pesticide',        health: 'Problems with blood, nervous system, or reproductive system. Leaching of soil fumigant used on rice and alfalfa.' },
  '2210': { name: '1,2-Dibromo-3-chloropropane (DBCP)', mcl: 0.0002, unit: 'mg/L', cat: 'Pesticide',   health: 'Reproductive difficulties; increased cancer risk. Residue of banned soil fumigant.' },
  '2214': { name: 'Ethylene Dibromide (EDB)',     mcl: 0.00005, unit: 'mg/L',  cat: 'Pesticide',        health: 'Liver, stomach, and reproductive system problems; increased cancer risk. Residue of banned soil fumigant used on soybeans, cotton, pineapple, and citrus.' },
  '2306': { name: 'Pentachlorophenol',            mcl: 0.001,   unit: 'mg/L',  cat: 'Pesticide',        health: 'Liver or kidney problems; increased cancer risk. Discharge from wood-preserving factories.' },
  '2326': { name: 'Dalapon',                      mcl: 0.2,     unit: 'mg/L',  cat: 'Pesticide',        health: 'Minor kidney changes. Runoff from herbicide use on rights of way.' },
  '2378': { name: 'Dioxin (2,3,7,8-TCDD)',        mcl: 0.00000003, unit: 'mg/L', cat: 'Pesticide',      health: 'Reproductive difficulties; increased cancer risk. Extremely potent industrial contaminant; byproduct of certain manufacturing and incineration processes.' },
  '2380': { name: 'Chlordane',                    mcl: 0.002,   unit: 'mg/L',  cat: 'Pesticide',        health: 'Liver or nervous system problems; increased cancer risk. Residue of banned termiticide; persists in soil for decades.' },
  '2440': { name: 'Hexachlorobenzene',            mcl: 0.001,   unit: 'mg/L',  cat: 'Pesticide',        health: 'Liver or kidney problems; reproductive difficulties; increased cancer risk. Discharge from metal refineries and agricultural chemical factories.' },
  '2274': { name: 'Hexachlorobenzene',            mcl: 0.001,   unit: 'mg/L',  cat: 'Pesticide',        health: 'Liver or kidney problems; reproductive difficulties; increased cancer risk. Discharge from metal refineries and agricultural chemical factories.' },
  '2595': { name: 'Metribuzin',                   mcl: 0.1,     unit: 'mg/L',  cat: 'Pesticide',        health: 'Herbicide used on soybeans, potatoes, and other crops. Runoff from agricultural fields. Liver effects at high levels.' },
  // Additional SOC/pesticide monitoring codes
  '2104': { name: '2,4,5-TP (Silvex)',            mcl: 0.05,    unit: 'mg/L',  cat: 'Pesticide',        health: 'A banned chlorinated herbicide formerly used on crops, orchards, and rights-of-way. Liver problems. Residues persist in the environment. EPA banned most uses in 1985.' },
  '2105': { name: '2,4-D',                        mcl: 0.07,    unit: 'mg/L',  cat: 'Pesticide',        health: 'One of the most widely used herbicides in the US, applied to lawns, crops, and rights-of-way. Kidney, liver, or adrenal gland problems at high levels. Enters water through agricultural and residential runoff.' },
  '2106': { name: 'Hexachlorocyclopentadiene',    mcl: 0.05,    unit: 'mg/L',  cat: 'Pesticide',        health: 'An industrial chemical used in the manufacture of pesticides and flame retardants. Kidney and stomach problems. Enters water from discharge of chemical plants.' },
  '2107': { name: 'Simazine',                     mcl: 0.004,   unit: 'mg/L',  cat: 'Pesticide',        health: 'A triazine herbicide used to control broadleaf weeds in agriculture and on lawns. May cause problems in blood, liver, kidney, and adrenal glands. Enters water from crop and residential runoff.' },
  '2300': { name: 'Aldicarb',                     mcl: 0.003,   unit: 'mg/L',  cat: 'Pesticide',        health: 'A carbamate insecticide used on cotton and potatoes. Nervous system effects; one of the most acutely toxic pesticides. Leaches readily into groundwater. Many states have set their own limits.' },
  '2335': { name: 'Aldicarb Sulfoxide',           mcl: 0.004,   unit: 'mg/L',  cat: 'Pesticide',        health: 'A breakdown product of aldicarb. Causes the same nervous system effects as aldicarb. Leaches into groundwater from treated agricultural soils.' },
  '2338': { name: 'Aldicarb Sulfone',             mcl: 0.002,   unit: 'mg/L',  cat: 'Pesticide',        health: 'Another breakdown product of aldicarb, also harmful to the nervous system. Persists longer in groundwater than aldicarb itself.' },
  '2017': { name: 'Diquat',                       mcl: 0.02,    unit: 'mg/L',  cat: 'Pesticide',        health: 'A non-selective herbicide used to control aquatic weeds and crops. Cataracts with long-term exposure. Runoff from herbicide use on crops.' },
  '2302': { name: 'Dinoseb',                      mcl: 0.007,   unit: 'mg/L',  cat: 'Pesticide',        health: 'A nitrophenol herbicide and pesticide. Reproductive difficulties. Runoff from use on soybeans and vegetables. Most uses were cancelled by EPA in 1986.' },
  '2259': { name: 'Toxaphene',                    mcl: 0.003,   unit: 'mg/L',  cat: 'Pesticide',        health: 'A banned chlorinated pesticide used on cotton and livestock. Kidney, liver, and thyroid problems; increased cancer risk. Residues in soil and sediment persist for decades.' },
  // Phase II/V SOC aliases - SDWIS uses alternate codes for same contaminants under different monitoring rules
  '2032': { name: 'Diquat',                             mcl: 0.02,    unit: 'mg/L',  cat: 'Pesticide',        health: 'A non-selective herbicide used to control aquatic weeds and crops. Cataracts with long-term exposure. Runoff from herbicide use on crops.' },
  '2033': { name: 'Endothall',                          mcl: 0.1,     unit: 'mg/L',  cat: 'Pesticide',        health: 'Herbicide used to control aquatic plants and algae. Stomach and intestinal problems; eye damage. Enters water from use on potato and cotton crops.' },
  '2036': { name: 'Oxamyl (Vydate)',                    mcl: 0.2,     unit: 'mg/L',  cat: 'Pesticide',        health: 'A carbamate insecticide used on cotton, fruit, and vegetable crops. Nervous system effects. May harm fetal development. Enters water through agricultural runoff.' },
  '2043': { name: 'Aldicarb Sulfoxide',                 mcl: 0.004,   unit: 'mg/L',  cat: 'Pesticide',        health: 'A breakdown product of aldicarb. Causes the same nervous system effects as aldicarb. Leaches into groundwater from treated agricultural soils.' },
  '2044': { name: 'Aldicarb Sulfone',                   mcl: 0.002,   unit: 'mg/L',  cat: 'Pesticide',        health: 'A breakdown product of aldicarb, also harmful to the nervous system. Persists longer in groundwater than aldicarb itself.' },
  '2046': { name: 'Carbofuran',                         mcl: 0.04,    unit: 'mg/L',  cat: 'Pesticide',        health: 'A highly toxic insecticide phased out in the US since 2009. Problems with blood, nervous system, or reproductive system. Leaches from soil fumigant use on rice and alfalfa.' },
  '2047': { name: 'Aldicarb',                           mcl: 0.003,   unit: 'mg/L',  cat: 'Pesticide',        health: 'A carbamate insecticide used on cotton and potatoes. Nervous system effects; one of the most acutely toxic pesticides. Leaches readily into groundwater.' },
  '2356': { name: 'Aldrin',                             mcl: null,    unit: 'mg/L',  cat: 'Pesticide',        health: 'A banned organochlorine pesticide, toxic to humans and wildlife. Tends to accumulate in the food chain. Banned in the US in 1974. No current federal MCL; monitored under unregulated contaminant programs.' },
  '2383': { name: 'Polychlorinated Biphenyls (PCBs)',   mcl: 0.0005,  unit: 'mg/L',  cat: 'Synthetic Organic', health: 'Industrial chemicals banned in the US in 1979. Probable human carcinogen; can harm the immune, reproductive, nervous, and endocrine systems. Enter water from hazardous waste sites and old electrical equipment.' },
  '2920': { name: 'Styrene',                            mcl: 0.1,     unit: 'mg/L',  cat: 'Volatile Organic', health: 'An industrial chemical used to make plastics and rubber. Liver, nervous system, and circulatory effects at high levels. Enters water from discharge of plastics and rubber factories.' },
  '2931': { name: 'DBCP (1,2-Dibromo-3-chloropropane)', mcl: 0.0002, unit: 'mg/L',  cat: 'Pesticide',        health: 'A soil fumigant banned in the 1970s after it caused sterility in male workers. Potential carcinogen; harms the male reproductive system. Still detected in some agricultural groundwater decades after use.' },
  '2946': { name: 'Ethylene Dibromide (EDB)',           mcl: 0.00005, unit: 'mg/L',  cat: 'Volatile Organic', health: 'A probable human carcinogen formerly used as a gasoline additive and pesticide, banned in 1984. Its extremely low MCL (0.05 ppb) reflects high toxicity. Still found in soil and groundwater near former agricultural areas.' },
  // Lead & Copper Rule codes used in VIOLATION table
  '0300': { name: 'Copper',  mcl: 1.3,   unit: 'mg/L',  cat: 'Heavy Metal',  health: 'Copper can cause short-term gastrointestinal distress. Excessive long-term exposure can cause liver and kidney damage. Copper in water usually comes from home plumbing.' },
  '0301': { name: 'Lead',    mcl: 0.015, unit: 'mg/L',  cat: 'Heavy Metal',  health: 'No safe level of lead exposure is known. It causes serious developmental and neurological harm, especially in children under 6 and pregnant women. Lead enters water from pipes and fixtures, not the source water.' },
  // LCR 90th percentile codes (used in LCR_SAMPLE_RESULT)
  'PB90': { name: 'Lead (90th Percentile)',   mcl: 0.015, unit: 'mg/L', cat: 'Heavy Metal', health: 'The 90th percentile lead level across all household tap samples. If this exceeds 0.015 mg/L, the utility must take corrective action. Even low levels are harmful to children.' },
  'CU90': { name: 'Copper (90th Percentile)', mcl: 1.3,   unit: 'mg/L', cat: 'Heavy Metal', health: 'The 90th percentile copper level. If above 1.3 mg/L, corrective action is required. Usually comes from household plumbing.' },
};

// ─── Violation Category Lookup ────────────────────────────────────
const VIOLATION_CATEGORIES = {
  'MCL':  { label: 'MCL Exceeded',               type: 'health',     color: 'health-based', desc: 'The level of a contaminant in your water exceeded the maximum legal limit (MCL) set by the EPA.' },
  'MRDL': { label: 'Disinfectant Level Exceeded', type: 'health',     color: 'health-based', desc: 'The disinfectant used to treat water exceeded the maximum residual disinfectant level allowed.' },
  'TT':   { label: 'Treatment Technique Failure', type: 'health',     color: 'health-based', desc: 'A required water treatment process (like filtration or disinfection) was not properly carried out.' },
  'M/R':  { label: 'Missed Testing',              type: 'monitoring', color: 'monitoring',   desc: 'Required water quality testing was not performed or results were not reported on time. Water may or may not be safe; we simply don\'t know.' },
  'PN':   { label: 'Public Notice',               type: 'reporting',  color: 'reporting',    desc: 'The utility failed to notify customers about a water quality issue within the required time.' },
  'CCR':  { label: 'Consumer Report Missing',     type: 'reporting',  color: 'reporting',    desc: 'The annual water quality report (Consumer Confidence Report) was not published or delivered to customers.' },
  'Other':{ label: 'Other Violation',             type: 'other',      color: 'other',        desc: 'A violation of the Safe Drinking Water Act occurred.' },
};

// Source type codes → readable labels
const SOURCE_TYPES = {
  GW: 'Groundwater', SW: 'Surface Water', GU: 'Groundwater Under Surface Water Influence',
  GWP: 'Groundwater Purchased', SWP: 'Surface Water Purchased',
};

// PWS type codes
const PWS_TYPES = {
  CWS: 'Community Water System', NTNCWS: 'Non-Transient Non-Community', TNCWS: 'Transient Non-Community',
};

// ─── DOM Refs ─────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const views = {
  search:    $('view-search'),
  loading:   $('view-loading'),
  select:    $('view-select'),
  report:    $('view-report'),
  noresults: $('view-noresults'),
  error:     $('view-error'),
};

// ─── View Management ──────────────────────────────────────────────
function showView(name) {
  state.view = name;
  Object.values(views).forEach(v => v.classList.remove('active'));
  if (views[name]) views[name].classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ─── URL Management ───────────────────────────────────────────────
function pushReportUrl(pwsid) {
  const target = `/report/${pwsid}`;
  if (window.location.pathname !== target) {
    history.pushState({ pwsid, view: 'report' }, '', target);
  }
  // Hide the SSR summary once JS has rendered the interactive report
  const ssrSummary = document.getElementById('ssr-summary');
  if (ssrSummary) ssrSummary.remove();
  const jsMsg = document.querySelector('.js-loading-msg');
  if (jsMsg) jsMsg.remove();
}

function pushSearchUrl() {
  if (window.location.pathname !== '/') {
    history.pushState({ view: 'search' }, '', '/');
  }
}

// ─── API Calls ────────────────────────────────────────────────────
async function fetchSystems(zip) {
  const res = await fetch(`/api/systems?zip=${encodeURIComponent(zip)}`, { cache: 'no-store' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Could not search water systems.');
  }
  return res.json();
}

async function fetchReport(pwsid) {
  const res = await fetch(`/api/report?pwsid=${encodeURIComponent(pwsid)}`, { cache: 'no-store' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Could not load the water quality report.');
  }
  return res.json();
}

// ─── Grade Computation ────────────────────────────────────────────
function computeGrade(violations) {
  const now = new Date();
  const fiveYearsAgo = new Date(now.getFullYear() - 5, now.getMonth(), now.getDate());

  // Health-based violations in last 5 years
  const recentHealth = violations.filter(v => {
    if (!v.isHealthBased) return false;
    const date = parseDate(v.beginDate);
    return date && date >= fiveYearsAgo;
  });

  // Currently active violations
  const activeViolations = violations.filter(v => isActive(v));
  const activeHealth = activeViolations.filter(v => v.isHealthBased);

  const score = {
    activeHealth: activeHealth.length,
    recentHealth: recentHealth.length,
    active: activeViolations.length,
  };

  let grade;
  if (activeHealth.length > 0)            grade = 'F';
  else if (recentHealth.length >= 5)      grade = 'D';
  else if (recentHealth.length >= 2)      grade = 'C';
  else if (recentHealth.length === 1)     grade = 'B';
  else if (activeViolations.length > 3)   grade = 'C';
  else                                    grade = 'A';

  const labels = {
    A: 'Meets all standards: no recent health-based violations',
    B: '1 recent health-based violation, generally safe',
    C: 'Multiple violations, some concern warranted',
    D: 'Significant health-based violations: take precautions',
    F: 'Active health violation: check with your utility immediately',
  };

  return { grade, label: labels[grade], score };
}

// ─── Helpers ─────────────────────────────────────────────────────
function parseDate(str) {
  if (!str) return null;
  // Handle formats: MM/DD/YYYY, YYYY-MM-DD, M/D/YYYY
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function formatDate(str) {
  const d = parseDate(str);
  if (!d) return '-';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function isActive(v) {
  // compliance_status_code meanings:
  //   R = Return to Compliance (resolved)
  //   K = Resolved by State (administrative closure)
  //   O = Open (active violation)
  //   (blank / other) = check end date
  const status = (v.status || '').toUpperCase().trim();
  if (status === 'R' || status === 'K') return false;  // Resolved
  if (status === 'O') return true;                     // Open = active
  // Fallback: check end date
  if (!v.endDate || v.endDate.trim() === '') return true;
  const end = parseDate(v.endDate);
  if (!end) return true;
  return end > new Date();
}

function getViolationCategory(v) {
  let cat = (v.violationCategory || '').trim().toUpperCase();
  if (cat === 'MR') cat = 'M/R'; // SDWIS uses both 'MR' and 'M/R'
  return VIOLATION_CATEGORIES[cat] || VIOLATION_CATEGORIES['Other'];
}

function getContaminantInfo(code) {
  const clean = String(code || '').replace(/^0+/, '').padStart(4, '0');
  return CONTAMINANTS[clean] || CONTAMINANTS[code] || null;
}

function getContaminantName(v) {
  if (v.contaminantName && v.contaminantName.trim()) return v.contaminantName.trim();
  const info = getContaminantInfo(v.contaminantCode);
  if (info) return info.name;
  return v.contaminantCode ? `Contaminant #${v.contaminantCode}` : 'Unknown Contaminant';
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pluralize(n, singular, plural = singular + 's') {
  return `${n} ${n === 1 ? singular : plural}`;
}

// ─── Rendering: System Cards ──────────────────────────────────────
function renderSystemCard(sys) {
  const pop = sys.population > 0
    ? `Serves ${sys.population.toLocaleString()} people`
    : '';
  const source = SOURCE_TYPES[sys.sourceType] || sys.sourceType || '';
  const type = PWS_TYPES[sys.pwsType] || sys.pwsType || '';
  const location = [sys.city, sys.state].filter(Boolean).join(', ');

  return `
    <button class="system-card" data-pwsid="${escapeHtml(sys.pwsid)}" role="listitem" aria-label="Select ${escapeHtml(sys.name)}">
      <div class="system-card-info">
        <div class="system-name">${escapeHtml(sys.name)}</div>
        <div class="system-meta">
          ${location ? `<span>📍 ${escapeHtml(location)}</span>` : ''}
          ${pop ? `<span>👥 ${escapeHtml(pop)}</span>` : ''}
          ${source ? `<span class="system-meta-pill">${escapeHtml(source)}</span>` : ''}
          ${type ? `<span class="system-meta-pill">${escapeHtml(type)}</span>` : ''}
          <span class="system-meta-pill" style="font-size:11px;color:var(--text-subtle)">ID: ${escapeHtml(sys.pwsid)}</span>
        </div>
      </div>
      <div class="system-card-arrow">→</div>
    </button>
  `;
}

// ─── Rendering: Report Header ─────────────────────────────────────
function renderReportHeader(system, gradeData) {
  const { grade } = gradeData;
  const location = [system.city, system.state].filter(Boolean).join(', ');
  const pop = system.population > 0 ? `${system.population.toLocaleString()} people served` : '';
  const source = SOURCE_TYPES[system.sourceType] || system.sourceType || '';

  return `
    <div class="grade-circle grade-${grade}" aria-label="Water quality grade ${grade}">${grade}</div>
    <div class="report-title">
      <div class="report-system-name">${escapeHtml(system.name)}</div>
      <div class="report-system-meta">
        ${location ? `<span>📍 ${escapeHtml(location)}</span>` : ''}
        ${pop ? `<span>👥 ${escapeHtml(pop)}</span>` : ''}
        ${source ? `<span>💧 ${escapeHtml(source)}</span>` : ''}
        <span>ID: ${escapeHtml(system.pwsid)}</span>
      </div>
      <div class="report-grade-label grade-label-${grade}">${escapeHtml(gradeData.label)}</div>
    </div>
  `;
}

// ─── Rendering: Stats Row ─────────────────────────────────────────
function renderStats(violations, samples, gradeData) {
  const active = violations.filter(isActive);
  const activeHealth = active.filter(v => v.isHealthBased);
  const totalHealth = violations.filter(v => v.isHealthBased);
  const leadSamples = samples.filter(s => ['PB90','pb90','0006','6'].includes(String(s.contaminantCode)));
  const copperSamples = samples.filter(s => ['CU90','cu90','0300','300'].includes(String(s.contaminantCode)));

  const leadAL = 0.015, copperAL = 1.3;
  const leadOver = leadSamples.filter(s => s.result > leadAL).length;
  const copperOver = copperSamples.filter(s => s.result > copperAL).length;

  return `
    <div class="stat-card">
      <div class="stat-number ${activeHealth.length > 0 ? 'danger' : 'safe'}">${activeHealth.length}</div>
      <div class="stat-label">Active Health Violations</div>
    </div>
    <div class="stat-card">
      <div class="stat-number ${totalHealth.length > 2 ? 'warn' : totalHealth.length > 0 ? 'warn' : 'muted'}">${totalHealth.length}</div>
      <div class="stat-label">Total Health Violations (history)</div>
    </div>
    <div class="stat-card">
      <div class="stat-number ${active.length > 0 ? 'warn' : 'safe'}">${active.length}</div>
      <div class="stat-label">Currently Open Violations</div>
    </div>
  `;
}

// ─── Rendering: Violation Card ────────────────────────────────────
function renderViolationCard(v) {
  const catInfo = getViolationCategory(v);
  const contaminantName = getContaminantName(v);
  const contaminantInfo = getContaminantInfo(v.contaminantCode);
  const active = isActive(v);
  const cardClass = catInfo.color;

  const statusBadge = active
    ? '<span class="badge badge-danger">● Active</span>'
    : '<span class="badge badge-muted">Resolved</span>';

  const typeBadge = v.isHealthBased
    ? '<span class="badge badge-danger">Health-Based</span>'
    : catInfo.type === 'monitoring'
      ? '<span class="badge badge-warn">Monitoring</span>'
      : '<span class="badge badge-purple">Reporting</span>';

  const healthCallout = contaminantInfo
    ? `<div class="health-callout${v.isHealthBased ? '' : ' health-callout-info'}">
        <span class="health-callout-icon">${v.isHealthBased ? '🩺' : 'ℹ️'}</span>
        <span>${escapeHtml(contaminantInfo.health)}</span>
       </div>`
    : '';

  const ruleName = v.ruleName ? `<span><strong>Rule:</strong> ${escapeHtml(v.ruleName)}</span>` : '';

  return `
    <div class="violation-card ${cardClass}" data-health="${v.isHealthBased}" data-active="${active}" data-type="${catInfo.type}">
      <div class="violation-top">
        <div class="violation-name">${escapeHtml(contaminantName)}</div>
        <div class="violation-badges">
          ${statusBadge}
          ${typeBadge}
        </div>
      </div>
      <p class="violation-desc">${escapeHtml(catInfo.desc)}</p>
      ${healthCallout}
      <div class="violation-meta">
        <span><strong>Type:</strong> ${escapeHtml(catInfo.label)}</span>
        <span><strong>Started:</strong> ${formatDate(v.beginDate)}</span>
        ${!active
          ? `<span><strong>Resolved:</strong> ${v.endDate ? formatDate(v.endDate) : 'Yes (via compliance)'}</span>`
          : '<span style="color:var(--danger);font-weight:600">⚠ Still open</span>'}
        ${ruleName}
      </div>
    </div>
  `;
}

// ─── Rendering: Lead & Copper Tab ─────────────────────────────────
function renderLeadCopper(samples) {
  // EPA SDWIS uses 'PB90' for lead 90th percentile and 'CU90' for copper
  // Some older entries may use numeric codes
  const leadCode   = ['PB90', 'pb90', '0006', '6', '1006'];
  const copperCode = ['CU90', 'cu90', '0300', '300', '1300'];

  const leadSamples   = samples.filter(s => leadCode.includes(String(s.contaminantCode)));
  const copperSamples = samples.filter(s => copperCode.includes(String(s.contaminantCode)));

  if (leadSamples.length === 0 && copperSamples.length === 0) {
    return `
      <div class="no-data-note">
        <span>ℹ️</span>
        <span>No lead or copper sample results are available for this water system in the EPA database. This is common for smaller systems or those that haven't triggered monitoring requirements.</span>
      </div>
      <div class="lc-intro">
        <strong>About Lead & Copper Testing:</strong> Under the EPA's Lead and Copper Rule, water systems must test water at homes with lead service lines or copper pipes with lead solder. If more than 10% of samples exceed the action levels (<strong>15 ppb for lead</strong>, <strong>1,300 ppb for copper</strong>), the utility must take corrective action.
        <br><br>
        <strong>Important:</strong> Even if your water system hasn't had lead violations, lead can enter drinking water from pipes and fixtures inside your home, especially in homes built before 1986. Consider a certified lead test kit or filter if you have concerns.
      </div>
    `;
  }

  const leadAL   = 0.015;  // mg/L = 15 ppb
  const copperAL = 1.3;    // mg/L = 1300 ppb

  const renderTable = (samples, contaminantName, actionLevel, unit) => {
    if (samples.length === 0) return `<p style="color:var(--text-subtle);font-size:14px;padding:8px 0">No ${contaminantName} sample data available.</p>`;

    // Sort by date desc, take most recent 20
    const sorted = [...samples]
      .sort((a, b) => (parseDate(b.sampleDate) || 0) - (parseDate(a.sampleDate) || 0))
      .slice(0, 20);

    const maxVal = Math.max(...sorted.map(s => s.result), actionLevel);

    const rows = sorted.map(s => {
      const pct = Math.min((s.result / maxVal) * 100, 100);
      const overLimit = s.result > actionLevel;
      const barClass = overLimit ? 'danger' : s.result > actionLevel * 0.7 ? 'warn' : 'safe';
      const valClass = overLimit ? 'danger' : 'safe';
      const sign = s.resultSign === '>' ? '>' : s.resultSign === '<' ? '<' : '';
      return `
        <tr>
          <td>${formatDate(s.sampleDate)}</td>
          <td>
            <div class="gauge-wrap">
              <div class="gauge-bar-bg">
                <div class="gauge-bar-fill ${barClass}" style="width:${pct.toFixed(1)}%"></div>
              </div>
              <span class="gauge-value ${valClass}">${sign}${s.result} ${unit}</span>
            </div>
          </td>
          <td>${overLimit ? '<span class="badge badge-danger">Over AL</span>' : '<span class="badge badge-safe">Below AL</span>'}</td>
        </tr>
      `;
    }).join('');

    return `
      <div class="lc-table-wrap">
        <table class="lc-table" aria-label="${contaminantName} samples">
          <thead>
            <tr>
              <th>Sample Date</th>
              <th>Level (Action Level = ${actionLevel} ${unit})</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p class="al-note">Action Level (AL): ${actionLevel} ${unit}. If >10% of samples exceed the AL, corrective action is required.</p>
    `;
  };

  return `
    <div class="lc-intro">
      <strong>Lead & Copper Rule:</strong> Water utilities must test for lead and copper at the tap. If more than 10% of samples exceed the action levels, the utility must take corrective action (like adding corrosion control treatment or replacing lead service lines).
      <br><br>
      <strong>Action Levels:</strong> Lead: <strong>15 ppb (0.015 mg/L)</strong> · Copper: <strong>1,300 ppb (1.3 mg/L)</strong>
      <br><br>
      Note: Lead in water often comes from <em>your home's own pipes and fixtures</em>, not the water source itself. Older homes (pre-1986) are at greater risk.
    </div>

    <h3 style="font-size:16px;font-weight:700;margin-bottom:8px">Lead Samples</h3>
    ${renderTable(leadSamples, 'Lead', leadAL, 'mg/L')}

    <h3 style="font-size:16px;font-weight:700;margin:20px 0 8px">Copper Samples</h3>
    ${renderTable(copperSamples, 'Copper', copperAL, 'mg/L')}
  `;
}

// ─── Rendering: Recommendations Tab ──────────────────────────────
function renderRecommendations(violations, samples, system) {
  const recs = [];
  const activeHealth = violations.filter(v => v.isHealthBased && isActive(v));
  const leadSamples   = samples.filter(s => ['PB90','pb90','0006','6'].includes(String(s.contaminantCode)));
  const leadOver      = leadSamples.filter(s => s.result > 0.015);
  const hasTthms      = violations.some(v => v.contaminantCode === '1005' && isActive(v));
  const hasNitrate    = violations.some(v => ['0008','0009'].includes(v.contaminantCode));
  const hasBacteria   = violations.some(v => ['2050','2051','2049'].includes(v.contaminantCode) && isActive(v));
  const hasRecentHealth = violations.filter(v => {
    const d = parseDate(v.beginDate);
    return v.isHealthBased && d && d > new Date(Date.now() - 5*365*24*60*60*1000);
  }).length > 0;

  if (activeHealth.length > 0) {
    recs.push({
      icon: '🚨',
      title: 'Active health violation: contact your utility',
      desc: `Your water system has ${pluralize(activeHealth.length, 'active health-based violation')}. Contact your utility immediately to ask what is being done and whether you should use bottled water or a certified filter in the meantime.`,
      priority: true,
      tags: ['Urgent', 'Call Your Utility'],
    });
  }

  if (hasBacteria) {
    recs.push({
      icon: '🦠',
      title: 'Boil water advisory may be needed',
      desc: 'Bacteria violations indicate possible microbial contamination. Boiling water for at least 1 minute kills most bacteria and viruses. Follow any boil water advisories from your utility.',
      priority: true,
      tags: ['Bacteria', 'Boil Water'],
    });
  }

  if (leadOver.length > 0) {
    recs.push({
      icon: '🪣',
      title: 'Flush your tap before drinking',
      desc: 'Lead was detected above the action level. Run your cold water tap for 30–60 seconds before drinking, especially after periods of non-use. Lead usually comes from your home\'s pipes, not the source water.',
      priority: true,
      tags: ['Lead', 'Especially for Children', 'Pregnant Women'],
    });
  }

  if (hasTthms) {
    recs.push({
      icon: '🚿',
      title: 'Consider a carbon filter for disinfection byproducts',
      desc: 'Trihalomethanes and haloacetic acids form when chlorine reacts with organic matter. An NSF-certified pitcher or under-sink activated carbon filter (NSF Standard 53) can reduce these compounds.',
      priority: false,
      tags: ['TTHMs', 'Filter Recommendation'],
    });
  }

  if (hasNitrate) {
    recs.push({
      icon: '🍼',
      title: 'Do not give tap water to infants if nitrate violation exists',
      desc: 'High nitrate levels can cause a dangerous blood disorder in babies under 6 months ("blue baby syndrome"). Use certified bottled water or a reverse osmosis filter for infant formula until the violation is resolved.',
      priority: hasRecentHealth,
      tags: ['Nitrate', 'Infants', 'Reverse Osmosis'],
    });
  }

  if (leadSamples.length > 0 && leadOver.length === 0) {
    recs.push({
      icon: '🏠',
      title: 'Check your home\'s plumbing for lead pipes',
      desc: 'Even if your water system passed lead tests, lead can enter water from pipes inside your home. Homes built before 1986 may have lead service lines or lead solder. A home test kit (around $20–$30) can confirm.',
      priority: false,
      tags: ['Lead', 'Home Plumbing'],
    });
  }

  if (violations.filter(v => !v.isHealthBased && isActive(v)).length > 0) {
    recs.push({
      icon: '📋',
      title: 'Ask your utility about open monitoring violations',
      desc: 'Monitoring violations mean required tests weren\'t done or reported. This doesn\'t automatically mean your water is unsafe, but it\'s worth asking your utility what happened.',
      priority: false,
      tags: ['Monitoring', 'Contact Utility'],
    });
  }

  if (recs.length === 0) {
    recs.push({
      icon: '✅',
      title: 'Your water meets all federal standards: no action required',
      desc: 'Based on available EPA records, this water system has no recent health-based violations. Continue using tap water normally. You may still consider a certified filter for taste or peace of mind.',
      priority: false,
      good: true,
      tags: ['No Violations Found'],
    });
  }

  recs.push({
    icon: '💧',
    title: 'Get your free annual water quality report',
    desc: 'Every community water system is required to publish an annual Consumer Confidence Report (CCR) by July 1 each year. Contact your utility or search for it online. It contains detailed testing results specific to your system.',
    priority: false,
    tags: ['Consumer Confidence Report', 'Free'],
  });

  recs.push({
    icon: '🔬',
    title: 'Know what filters work for what',
    desc: `
      <strong>Activated carbon (pitcher/faucet):</strong> Removes chlorine, TTHMs, HAAs, some VOCs and pesticides. Does NOT remove lead well on its own.<br>
      <strong>NSF 53 certified filter:</strong> Specifically tested to reduce lead and other contaminants; look for this certification.<br>
      <strong>Reverse osmosis:</strong> Removes nearly everything including lead, nitrates, arsenic, radionuclides, and PFAS. More expensive but comprehensive.<br>
      <strong>Boiling:</strong> Kills bacteria and viruses. Does NOT remove chemical contaminants.
    `,
    priority: false,
    tags: ['Filter Guide'],
  });

  return `<div class="recs-grid">${recs.map(r => `
    <div class="rec-card ${r.priority ? 'priority' : ''} ${r.good ? 'good' : ''}">
      <div class="rec-icon">${r.icon}</div>
      <div class="rec-body">
        <div class="rec-title">${escapeHtml(r.title)}</div>
        <div class="rec-desc">${r.desc.includes('<') ? r.desc : escapeHtml(r.desc)}</div>
        ${r.tags ? `<div class="rec-tags">${r.tags.map(t => `<span class="rec-tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
      </div>
    </div>
  `).join('')}</div>`;
}

// ─── Report Rendering ─────────────────────────────────────────────
function renderReport(report) {
  const { system, violations, samples } = report;

  const gradeData = computeGrade(violations);

  // Header
  $('report-header').innerHTML = renderReportHeader(system, gradeData);

  // Stats
  $('report-stats').innerHTML = renderStats(violations, samples, gradeData);

  // Tab counts
  const healthCount = violations.filter(v => v.isHealthBased).length;
  const leadCount   = samples.filter(s => ['PB90','pb90','CU90','cu90','0006','6','0300','300'].includes(String(s.contaminantCode))).length;

  const violCount = $('tab-count-violations');
  const leadCnt   = $('tab-count-lead');
  violCount.textContent = violations.length;
  violCount.classList.toggle('has-danger', healthCount > 0);
  leadCnt.textContent = leadCount;

  // Violations tab
  renderViolationsTab(violations);

  // Lead & Copper tab
  $('lead-copper-content').innerHTML = renderLeadCopper(samples);

  // Recommendations tab
  $('recs-content').innerHTML = renderRecommendations(violations, samples, system);

  showView('report');
}

function renderViolationsTab(violations, filter = 'all', activeOnly = false) {
  let filtered = violations;

  if (filter === 'health')      filtered = filtered.filter(v => v.isHealthBased);
  else if (filter === 'monitoring') filtered = filtered.filter(v => !v.isHealthBased);

  if (activeOnly) filtered = filtered.filter(isActive);

  // Sort: active first, then by beginDate desc
  filtered.sort((a, b) => {
    const aActive = isActive(a) ? 1 : 0;
    const bActive = isActive(b) ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    const da = parseDate(a.beginDate) || 0;
    const db = parseDate(b.beginDate) || 0;
    return db - da;
  });

  const list = $('violations-list');

  if (filtered.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🎉</div>
        <h3>${violations.length === 0 ? 'No violation records found' : 'No violations match this filter'}</h3>
        <p>${violations.length === 0
          ? 'The EPA database has no violation records for this water system, or the data may not be available.'
          : 'Try adjusting your filters to see more results.'}</p>
      </div>
    `;
    return;
  }

  list.innerHTML = filtered.map(renderViolationCard).join('');
}

// ─── Event Handlers ───────────────────────────────────────────────

// Search form
$('search-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const zip = $('zip-input').value.trim();
  const errorEl = $('search-error');

  if (!/^\d{5}$/.test(zip)) {
    errorEl.textContent = 'Please enter a valid 5-digit ZIP code.';
    $('zip-input').focus();
    return;
  }

  errorEl.textContent = '';
  state.zip = zip;

  showView('loading');
  $('loading-text').textContent = `Searching for water systems in ${zip}…`;

  try {
    const systems = await fetchSystems(zip);
    state.systems = systems;

    if (systems.length === 0) {
      $('noresults-zip').textContent = zip;
      showView('noresults');
      return;
    }

    if (systems.length === 1) {
      // Auto-select if only one system
      await loadSystem(systems[0]);
    } else {
      $('select-zip').textContent = zip;
      $('systems-list').innerHTML = systems.map(renderSystemCard).join('');
      showView('select');
    }
  } catch (err) {
    $('error-msg').textContent = err.message || 'An unexpected error occurred.';
    showView('error');
  }
});

// Only allow digits in ZIP input
$('zip-input').addEventListener('input', function () {
  this.value = this.value.replace(/\D/g, '').slice(0, 5);
});

// System selection
$('systems-list').addEventListener('click', async (e) => {
  const card = e.target.closest('.system-card');
  if (!card) return;
  const pwsid = card.dataset.pwsid;
  const system = state.systems.find(s => s.pwsid === pwsid);
  if (system) await loadSystem(system);
});

async function loadSystem(system) {
  state.selectedSystem = system;
  showView('loading');
  $('loading-text').textContent = `Loading report for ${system.name}…`;

  try {
    const report = await fetchReport(system.pwsid);
    state.report = report;
    if (!report.system) report.system = system;
    renderReport(report);
    pushReportUrl(system.pwsid);
  } catch (err) {
    $('error-msg').textContent = err.message || 'Failed to load the water quality report.';
    showView('error');
  }
}

async function loadSystemById(pwsid) {
  showView('loading');
  $('loading-text').textContent = `Loading report…`;
  try {
    const report = await fetchReport(pwsid);
    state.report = report;
    state.selectedSystem = report.system;
    renderReport(report);
  } catch (err) {
    $('error-msg').textContent = err.message || 'Failed to load the water quality report.';
    showView('error');
  }
}

// Back buttons
$('back-from-select').addEventListener('click', () => {
  showView('search');
  $('zip-input').value = state.zip;
  $('zip-input').focus();
});

$('back-from-report').addEventListener('click', () => {
  pushSearchUrl();
  if (state.systems.length > 1) {
    showView('select');
  } else {
    showView('search');
    $('zip-input').value = state.zip;
  }
});

$('noresults-back').addEventListener('click', () => {
  showView('search');
  $('zip-input').focus();
});

$('error-back').addEventListener('click', () => {
  if (state.systems.length > 0) {
    showView('select');
  } else {
    showView('search');
  }
});

$('logo-link').addEventListener('click', (e) => {
  e.preventDefault();
  pushSearchUrl();
  showView('search');
  $('zip-input').value = '';
  $('search-error').textContent = '';
});

// Section scroll-spy - highlights the nav link for the section nearest the top
const _sectionLinks = document.querySelectorAll('.section-link[href^="#"]');
const _sectionObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      _sectionLinks.forEach(link =>
        link.classList.toggle('active', link.getAttribute('href') === `#${entry.target.id}`)
      );
    }
  });
}, {
  // Fire when section crosses ~20% from the top of the viewport
  rootMargin: '-15% 0px -75% 0px',
  threshold: 0,
});
document.querySelectorAll('.report-section').forEach(sec => _sectionObserver.observe(sec));

// Violation filters
document.querySelector('.filter-group').addEventListener('click', (e) => {
  const btn = e.target.closest('.filter-btn');
  if (!btn) return;

  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  const filter = btn.dataset.filter;
  const activeOnly = $('active-only').checked;
  renderViolationsTab(state.report?.violations || [], filter, activeOnly);
});

$('active-only').addEventListener('change', () => {
  const filter = document.querySelector('.filter-btn.active')?.dataset.filter || 'all';
  renderViolationsTab(state.report?.violations || [], filter, $('active-only').checked);
});

// ─── Browser back / forward ───────────────────────────────────────
window.addEventListener('popstate', async (e) => {
  // Hash anchor clicks (tab navigation) fire popstate with null state - ignore them
  if (!e.state && window.location.hash) return;

  const s = e.state;
  if (s && s.pwsid) {
    // Navigating to a report - use cached report if available, otherwise fetch
    if (state.report && state.report.system && state.report.system.pwsid === s.pwsid) {
      renderReport(state.report);
    } else {
      await loadSystemById(s.pwsid);
    }
  } else {
    // Navigating back to home / search
    showView('search');
    if (state.zip) $('zip-input').value = state.zip;
  }
});

// ─── SSR hydration: if server pre-loaded report data, render it ───
// This runs when the user visits /report/:pwsid directly (SSR page).
if (window.__PRELOADED__) {
  const { system, violations, samples } = window.__PRELOADED__;
  if (system) {
    state.report          = { system, violations, samples };
    state.selectedSystem  = system;
    // Replace browser history entry so back button goes home
    history.replaceState({ pwsid: system.pwsid, view: 'report' }, '', window.location.pathname);
    renderReport(state.report);
    // Clean up SSR summary after interactive report renders
    const ssrEl = document.getElementById('ssr-summary');
    if (ssrEl) ssrEl.remove();
    const jsMsg = document.querySelector('.js-loading-msg');
    if (jsMsg) jsMsg.remove();
  }
}
