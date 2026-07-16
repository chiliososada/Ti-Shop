export type BlogBlock =
  | { type: "p"; text: string }
  | { type: "h2"; text: string }
  | { type: "ul"; items: string[] };

export type BlogPost = {
  slug: string;
  title: string;
  metaTitle: string;
  metaDescription: string;
  category: string;
  readingTime: string;
  excerpt: string;
  keyword: string;
  date: string; // ISO
  author: string;
  cover: string;
  body: BlogBlock[];
  takeaways: string[];
  faqs: { q: string; a: string }[];
  related?: string[];
};

const AUTHOR = "sheng.an Editorial";

export const posts: BlogPost[] = [
  {
    slug: "peptide-certificate-of-analysis-coa-explained",
    title: "What Is a Certificate of Analysis (COA) for Research Peptides?",
    metaTitle: "Peptide Certificate of Analysis (COA) Explained",
    metaDescription:
      "What a peptide Certificate of Analysis (COA) is, how to read purity, identity, and content data, and why every research peptide order should include one.",
    category: "Quality & Testing",
    readingTime: "7 min",
    excerpt:
      "A Certificate of Analysis is the batch-specific document that verifies a research peptide's identity, purity, and composition before it ever reaches your lab bench.",
    keyword: "peptide certificate of analysis",
    date: "2026-06-18",
    author: AUTHOR,
    cover: "/categories/antibacterial.jpg",
    related: [
      "peptide-purity-hplc-mass-spectrometry-explained",
      "how-to-reconstitute-lyophilized-research-peptides",
    ],
    body: [
      { type: "h2", text: "What a Certificate of Analysis Actually Is" },
      {
        type: "p",
        text: "A Certificate of Analysis, or COA, is a batch-specific quality document that reports the analytical test results for a defined lot of material. For research peptides, it is the primary evidence that what is printed on the vial label matches what is actually inside it.",
      },
      {
        type: "p",
        text: "A COA is not a marketing sheet or a generic product spec. It is tied to a single synthesis batch, generated from instrument data, and should be traceable back to the lot number on the vial. If a document is not batch-specific, it is not a true COA.",
      },
      { type: "h2", text: "Why a COA Matters in a Research Setting" },
      {
        type: "p",
        text: "Research reproducibility depends on knowing exactly what compound was used, at what purity, and in what quantity. Without that documentation, experimental results cannot be reliably compared, repeated, or published. A COA turns an unknown white powder into a characterized, documented research input.",
      },
      {
        type: "p",
        text: "For procurement and quality teams, the COA is also an audit and record-keeping artifact. It supports material traceability, supplier qualification, and internal chain-of-custody records that many research organizations are required to maintain.",
      },
      { type: "h2", text: "The Core Data Points on a Peptide COA" },
      {
        type: "p",
        text: "Every credible peptide COA should report a consistent set of analytical fields. These are the values a researcher checks first.",
      },
      {
        type: "ul",
        items: [
          "Product name and full peptide sequence (single-letter or three-letter code)",
          "Batch or lot number, and manufacture/analysis date",
          "Molecular formula and molecular weight (theoretical vs. observed)",
          "Purity by HPLC, expressed as a percentage (e.g. ≥99%)",
          "Identity confirmation by mass spectrometry (MS)",
          "Net peptide content and, where relevant, counter-ion/salt form",
          "Physical appearance (typically white to off-white lyophilized powder)",
          "Storage and handling conditions",
        ],
      },
      { type: "h2", text: "How to Read Purity and Identity Correctly" },
      {
        type: "p",
        text: "Purity and identity are two different measurements and should never be confused. HPLC purity tells you what percentage of the material is your target peptide versus related impurities. Mass spectrometry confirms identity by matching the observed molecular weight to the theoretical value for that sequence.",
      },
      {
        type: "p",
        text: "A high purity figure with no identity confirmation is incomplete, and an identity match with no purity value is equally incomplete. A trustworthy COA carries both, ideally with the underlying chromatogram and mass spectrum attached or available on request.",
      },
      { type: "h2", text: "Net Peptide Content vs. Gross Weight" },
      {
        type: "p",
        text: "One of the most misunderstood fields is net peptide content. Lyophilized peptides typically contain residual counter-ions (such as acetate or trifluoroacetate) and bound water. This means the gross powder weight in the vial is not 100% peptide.",
      },
      {
        type: "p",
        text: "Net peptide content states how much of the vial's mass is the actual peptide. For researchers standardizing material across experiments, this value is essential for accurate, reproducible preparation of stock solutions.",
      },
      { type: "h2", text: "What Separates a Real COA From a Placeholder" },
      {
        type: "p",
        text: "A genuine COA is generated from real instrument runs on the specific lot you received. A placeholder document reuses the same numbers across every batch, omits the chromatogram and spectrum, or lists no lot number at all. Those are red flags during supplier evaluation.",
      },
      {
        type: "p",
        text: "When procuring a material, ask for the COA tied to the actual lot and compare its lot number, methods and reported results with the product received. Do not treat a generic catalog specification as lot-specific evidence.",
      },
      { type: "h2", text: "Using the COA in Your Records" },
      {
        type: "p",
        text: "Beyond the initial check, the COA should be retained. File it against the lot number, log receipt in your inventory system, and keep it accessible for the life of any experiment that used the material. This closes the traceability loop from manufacturer synthesis to bench use.",
      },
    ],
    takeaways: [
      "A COA is a batch-specific, instrument-derived quality document — not a generic spec sheet.",
      "Always confirm both HPLC purity and MS identity; the two answer different questions.",
      "Net peptide content, not gross vial weight, is the accurate basis for reproducible stock preparation.",
      "Retain every COA against its lot number to maintain full material traceability.",
    ],
    faqs: [
      {
        q: "What is the difference between a COA and a product datasheet?",
        a: "A datasheet describes a product in general terms, while a COA reports actual analytical test results for one specific manufactured batch, tied to a unique lot number.",
      },
      {
        q: "Should every research peptide order include a COA?",
        a: "A procurement or quality process may require one. Confirm whether a lot-specific COA is available before ordering; a product page alone does not establish that the document exists.",
      },
      {
        q: 'What does "net peptide content" mean on a COA?',
        a: "It is the portion of the vial's total mass that is the actual peptide, excluding residual salts and bound water, which is the correct basis for accurate solution preparation.",
      },
    ],
  },
  {
    slug: "how-to-reconstitute-lyophilized-research-peptides",
    title:
      "How to Reconstitute Lyophilized Research Peptides with Bacteriostatic Water",
    metaTitle: "How to Reconstitute Lyophilized Research Peptides",
    metaDescription:
      "A lab-procedure guide to reconstituting lyophilized research peptides with bacteriostatic water, covering handling, technique, and storage. Research use only.",
    category: "Lab Protocols",
    readingTime: "8 min",
    excerpt:
      "A clear laboratory-handling walkthrough for reconstituting lyophilized research peptides, from choosing a diluent to gentle mixing and correct cold storage.",
    keyword: "how to reconstitute peptides",
    date: "2026-06-25",
    author: AUTHOR,
    cover: "/categories/bac-water.jpg",
    related: [
      "peptide-certificate-of-analysis-coa-explained",
      "peptide-purity-hplc-mass-spectrometry-explained",
    ],
    body: [
      {
        type: "p",
        text: "Note: This article describes laboratory handling of Research Use Only materials. It is not guidance for human or animal use of any kind.",
      },
      { type: "h2", text: "Why Peptides Ship Lyophilized" },
      {
        type: "p",
        text: "Most research peptides are supplied as a lyophilized (freeze-dried) powder because the dry state is far more stable during storage and international shipping than a solution. Removing water slows the degradation reactions that would otherwise shorten a peptide's usable life.",
      },
      {
        type: "p",
        text: "Reconstitution is simply the controlled process of returning that dry powder to a liquid solution so it can be handled in the lab. Done carefully, it preserves the integrity and characterized purity of the material.",
      },
      { type: "h2", text: "Choosing a Diluent" },
      {
        type: "p",
        text: "The most common diluent for reconstituting research peptides in a laboratory setting is bacteriostatic water — sterile water containing a small amount of a bacteriostatic agent that suppresses microbial growth in a multi-draw container. Sterile water and certain buffered solutions are also used depending on the peptide's solubility profile.",
      },
      {
        type: "p",
        text: "Some peptides are poorly soluble in neutral water and may require a specific solvent noted on their documentation. Always check the peptide's COA and product page for solubility guidance before selecting a diluent.",
      },
      {
        type: "ul",
        items: [
          "Bacteriostatic water — common choice for multi-use lab stock solutions",
          "Sterile water — for single-use preparation",
          "Buffered or mildly acidic solvents — for peptides with limited neutral-water solubility",
        ],
      },
      { type: "h2", text: "Materials to Prepare" },
      {
        type: "p",
        text: "Working cleanly reduces contamination and preserves solution quality. Assemble everything before opening the vial.",
      },
      {
        type: "ul",
        items: [
          "The lyophilized peptide vial and its matching COA",
          "Bacteriostatic water (or the specified diluent)",
          "Sterile syringes and needles, or a calibrated pipette",
          "Alcohol wipes for swabbing vial stoppers",
          "A clean, draft-free work surface",
          "Labels for lot number, concentration, and date",
        ],
      },
      { type: "h2", text: "The Reconstitution Procedure" },
      {
        type: "p",
        text: "The goal is to introduce the diluent slowly and let the powder dissolve without harsh agitation. Peptides are sensitive to mechanical and thermal stress.",
      },
      {
        type: "ul",
        items: [
          "Let the vial equilibrate to room temperature to reduce condensation.",
          "Swab both the peptide vial stopper and the diluent stopper with alcohol.",
          "Draw the calculated volume of diluent to reach your target concentration.",
          "Insert the needle at an angle and let the diluent run slowly down the inner glass wall, not directly onto the powder.",
          "Do not shake. Allow the peptide to dissolve on its own, or swirl gently.",
          "Wait until the solution is completely clear before use.",
        ],
      },
      { type: "h2", text: "Calculating Concentration" },
      {
        type: "p",
        text: "Concentration is determined by the mass of peptide in the vial divided by the volume of diluent added. Use the net peptide content from the COA rather than gross vial weight for an accurate figure.",
      },
      {
        type: "p",
        text: "For example, if a vial contains a known net quantity of peptide and you add a specific diluent volume, the resulting concentration follows directly from that ratio. Standardizing this calculation across your lab supports reproducible experimental preparation.",
      },
      { type: "h2", text: "Handling, Mixing, and Common Mistakes" },
      {
        type: "p",
        text: "The most frequent handling errors damage the peptide or the solution. Avoid vigorous shaking, which can denature sensitive sequences and introduce foaming. Avoid adding hot diluent. Avoid spraying diluent directly onto the powder pellet with force.",
      },
      {
        type: "p",
        text: "A cloudy or persistently undissolved solution can indicate a solubility mismatch — pause and recheck the recommended diluent rather than forcing dissolution.",
      },
      { type: "h2", text: "Storage After Reconstitution" },
      {
        type: "p",
        text: "Once in solution, peptides are less stable than in their dry form, so storage conditions matter. Reconstituted solutions are generally kept refrigerated for short-term work and frozen for longer-term storage, with the exact conditions guided by the specific peptide's documentation.",
      },
      {
        type: "p",
        text: "Label prepared research material according to your laboratory's protocol and the applicable product documentation. Transport and handling requirements vary, so confirm them for the actual material and order rather than assuming a universal cold-chain service.",
      },
    ],
    takeaways: [
      "Reconstitution restores freeze-dried peptide to solution; do it gently to preserve integrity.",
      "Add diluent slowly down the vial wall and never shake — swirl to dissolve.",
      "Base concentration calculations on net peptide content from the COA, not gross weight.",
      "Store reconstituted solutions cold, label fully, and limit freeze-thaw cycles.",
    ],
    faqs: [
      {
        q: "What is bacteriostatic water used for in peptide reconstitution?",
        a: "It is a sterile diluent containing a bacteriostatic agent that suppresses microbial growth, making it a common choice for preparing multi-draw research stock solutions.",
      },
      {
        q: "Why should you avoid shaking a peptide during reconstitution?",
        a: "Shaking creates mechanical and foaming stress that can denature sensitive peptide sequences. Gentle swirling and slow diluent addition preserve solution quality.",
      },
      {
        q: "How is peptide concentration calculated after reconstitution?",
        a: "Divide the net peptide content (from the COA) by the volume of diluent added. Using net content rather than gross vial weight gives an accurate, reproducible concentration.",
      },
    ],
  },
  {
    slug: "peptide-purity-hplc-mass-spectrometry-explained",
    title:
      "How Peptide Purity Is Verified: HPLC and Mass Spectrometry Explained",
    metaTitle: "Peptide Purity: HPLC & Mass Spectrometry Explained",
    metaDescription:
      "How research peptide purity is verified using HPLC and mass spectrometry, what ≥99% purity really means, and how to read the data on a COA.",
    category: "Peptide Science",
    readingTime: "7 min",
    excerpt:
      "A plain-language explanation of the two analytical methods behind every purity claim: HPLC for how much target peptide is present, and MS for confirming its identity.",
    keyword: "peptide purity HPLC",
    date: "2026-07-02",
    author: AUTHOR,
    cover: "/categories/growth-energy.jpg",
    related: [
      "peptide-certificate-of-analysis-coa-explained",
      "glp-1-research-peptides-explained",
    ],
    body: [
      { type: "h2", text: "Why Purity Is the Central Quality Metric" },
      {
        type: "p",
        text: "For a research peptide, purity is the single most important quality metric because impurities are experimental variables. Related peptide fragments, deletion sequences, and residual synthesis byproducts can all influence results if they go unmeasured.",
      },
      {
        type: "p",
        text: "A stated purity figure only means something when it is backed by the analytical method used to measure it. That is why credible manufacturers report purity alongside the technique and the underlying data, not as a bare number.",
      },
      { type: "h2", text: "Purity and Identity Are Two Different Questions" },
      {
        type: "p",
        text: "It is essential to separate two concepts that are often blurred. Purity asks: what percentage of this material is my target peptide? Identity asks: is this material actually the peptide I ordered? A sample can be highly pure but be the wrong compound, or be correctly identified but contaminated.",
      },
      {
        type: "p",
        text: "HPLC can address a purity question while mass spectrometry can address identity. When those results are required, confirm that the actual lot documentation reports the relevant methods and data rather than relying on a catalog claim.",
      },
      { type: "h2", text: "How HPLC Measures Purity" },
      {
        type: "p",
        text: "High-Performance Liquid Chromatography (HPLC) separates the components of a sample as they pass through a column at different speeds. The target peptide and any impurities emerge at different times, producing a chromatogram of peaks.",
      },
      {
        type: "p",
        text: "The area under the main peak, relative to the total area of all peaks, gives the purity percentage. A clean chromatogram dominated by a single sharp peak with minimal surrounding peaks indicates high purity.",
      },
      {
        type: "ul",
        items: [
          "Sample is injected and carried through a separation column",
          "Components separate by their chemical interaction with the column",
          "A detector records each component as a peak over time",
          "Main peak area ÷ total peak area = purity percentage",
        ],
      },
      { type: "h2", text: "What ≥99% Purity Actually Means" },
      {
        type: "p",
        text: "A purity of ≥99% by HPLC means that, of all the material detected, at least 99% is the target peptide and less than 1% is combined impurities. This is a demanding specification and reflects tight control over synthesis and purification.",
      },
      {
        type: "p",
        text: 'It is important to note the qualifier "by HPLC," because purity is method-dependent. A reputable COA always states the method and ideally includes the chromatogram so the peak profile can be inspected directly rather than taken on trust.',
      },
      { type: "h2", text: "How Mass Spectrometry Confirms Identity" },
      {
        type: "p",
        text: "Mass spectrometry (MS) measures the mass-to-charge ratio of a molecule, allowing its molecular weight to be determined with high precision. For a peptide, the observed molecular weight is compared against the theoretical weight calculated from its amino acid sequence.",
      },
      {
        type: "p",
        text: "When the observed and theoretical values match within a small tolerance, identity is confirmed. If they differ, it can signal a wrong sequence, a modification, or a synthesis error — which is exactly why MS is run in tandem with HPLC.",
      },
      { type: "h2", text: "Reading the Data on a COA" },
      {
        type: "p",
        text: "On a well-constructed COA, the HPLC section shows the purity percentage and often the retention time and chromatogram, while the MS section shows the theoretical and observed molecular weights alongside the mass spectrum.",
      },
      {
        type: "p",
        text: "When evaluating a supplier, look past the headline number to the actual traces. A single dominant HPLC peak and a matching MS value together are far stronger evidence than a percentage printed in isolation.",
      },
      { type: "h2", text: "From Analysis to Reproducible Research" },
      {
        type: "p",
        text: "Verified purity and confirmed identity are what make a peptide a controlled research input rather than an unknown. When every batch is characterized the same way, results become comparable across experiments and over time.",
      },
      {
        type: "p",
        text: "For any supplier, a headline specification should be checked against the methods and results reported for the actual lot. Ask for the relevant document before ordering when analytical evidence is part of your procurement criteria.",
      },
    ],
    takeaways: [
      "HPLC measures how much target peptide is present; MS confirms it is the right peptide.",
      "≥99% purity means impurities total under 1% by the HPLC method — always note the method.",
      "Inspect the actual chromatogram and mass spectrum, not just the headline percentage.",
      "Consistent HPLC+MS characterization per batch is what makes research reproducible.",
    ],
    faqs: [
      {
        q: "What does 99% purity mean for a research peptide?",
        a: "It means at least 99% of the detected material is the target peptide and under 1% is impurities, as measured by HPLC. The method qualifier matters because purity is method-dependent.",
      },
      {
        q: "Why are both HPLC and mass spectrometry needed?",
        a: "HPLC quantifies purity (how much target is present) while MS confirms identity (whether it is the correct molecule). Each answers a different question, so both are required for full characterization.",
      },
      {
        q: "How is peptide identity confirmed by mass spectrometry?",
        a: "MS measures the molecule's molecular weight and compares the observed value to the theoretical weight from the peptide's sequence. A close match confirms identity.",
      },
    ],
  },
  {
    slug: "glp-1-research-peptides-explained",
    title:
      "GLP-1 Research Peptides Explained: Tirzepatide, Semaglutide & Retatrutide",
    metaTitle: "GLP-1 Research Peptides Explained | sheng.an",
    metaDescription:
      "Research overview of tirzepatide, semaglutide, and retatrutide, including receptor targets, compound handling, and study context. Research use only.",
    category: "Peptide Science",
    readingTime: "8 min",
    excerpt:
      "A research-focused overview of GLP-1 class peptides, describing their receptor targets and molecular characteristics as study compounds — strictly for laboratory research use.",
    keyword: "GLP-1 research peptides",
    date: "2026-07-09",
    author: AUTHOR,
    cover: "/categories/metabolic.jpg",
    related: [
      "peptide-purity-hplc-mass-spectrometry-explained",
      "peptide-certificate-of-analysis-coa-explained",
    ],
    body: [
      {
        type: "p",
        text: "Note: The peptides discussed here are Research Use Only compounds intended for in vitro and laboratory research. This article describes their molecular characteristics and receptor biology as studied in research settings. It does not describe, recommend, or imply any human or animal use, dosing, or health outcome.",
      },
      { type: "h2", text: 'What "GLP-1" Refers To' },
      {
        type: "p",
        text: "GLP-1 stands for glucagon-like peptide-1, a naturally occurring incretin peptide that is widely studied in metabolic research. In the laboratory, GLP-1 is of interest because of the receptor it binds — the GLP-1 receptor — which is a well-characterized target in receptor-signaling studies.",
      },
      {
        type: "p",
        text: 'The term "GLP-1 research peptides" refers to a class of synthetic compounds designed to interact with this receptor system. They are studied as tools for understanding receptor pharmacology, signaling pathways, and structure-activity relationships in vitro.',
      },
      { type: "h2", text: "The Incretin Receptor Landscape" },
      {
        type: "p",
        text: "Metabolic research often involves more than one incretin receptor. Two receptors appear frequently in this literature: the GLP-1 receptor and the GIP receptor (glucose-dependent insulinotropic polypeptide receptor). Some research compounds are designed to engage one receptor, and others to engage multiple.",
      },
      {
        type: "p",
        text: "Understanding which receptors a given peptide targets is central to interpreting research data, because the receptor profile defines the signaling pathways under investigation.",
      },
      { type: "h2", text: "Semaglutide as a Research Compound" },
      {
        type: "p",
        text: "Semaglutide is a synthetic peptide studied as a GLP-1 receptor agonist — a molecule that binds and activates the GLP-1 receptor in experimental systems. In structural terms, it is a modified peptide engineered for stability, which makes it a common reference compound in receptor-signaling research.",
      },
      {
        type: "p",
        text: "As a single-receptor-target research tool, semaglutide is frequently used in comparative studies alongside dual- and triple-target compounds to map differences in receptor engagement.",
      },
      { type: "h2", text: "Tirzepatide as a Dual-Target Research Compound" },
      {
        type: "p",
        text: "Tirzepatide is studied as a dual receptor agonist, designed to interact with both the GIP receptor and the GLP-1 receptor. This dual profile makes it a compound of interest for researchers examining how simultaneous engagement of two incretin receptors differs from single-receptor activation.",
      },
      {
        type: "p",
        text: "In a research context, its value lies in comparative pharmacology — allowing study of combined receptor signaling within a single molecule.",
      },
      { type: "h2", text: "Retatrutide as a Triple-Target Research Compound" },
      {
        type: "p",
        text: "Retatrutide is described in the research literature as a triple receptor agonist, engaging the GLP-1 receptor, the GIP receptor, and the glucagon receptor. It represents the multi-target end of this research spectrum.",
      },
      {
        type: "p",
        text: "For laboratories studying receptor-signaling networks, triple-target compounds like retatrutide are of interest precisely because they allow investigation of how three receptor pathways interact when engaged by one molecule.",
      },
      {
        type: "ul",
        items: [
          "Semaglutide — studied as a single-target GLP-1 receptor agonist",
          "Tirzepatide — studied as a dual GIP/GLP-1 receptor agonist",
          "Retatrutide — studied as a triple GLP-1/GIP/glucagon receptor agonist",
        ],
      },
      {
        type: "h2",
        text: "Why Purity and Documentation Matter for This Class",
      },
      {
        type: "p",
        text: "Because these are structurally complex, modified peptides, small synthesis impurities can meaningfully affect research outcomes. That makes verified purity and confirmed identity especially important for this category.",
      },
      {
        type: "p",
        text: "If HPLC purity and MS identity are required for a GLP-1-related research material, confirm that those results are available for the actual lot. A category page or generic specification is not a substitute for lot-specific evidence.",
      },
      { type: "h2", text: "Handling and Storage Considerations" },
      {
        type: "p",
        text: "Like other research peptides, GLP-1 class compounds are supplied lyophilized and require careful reconstitution and cold storage to preserve integrity. General laboratory handling principles — gentle reconstitution, accurate concentration calculation from net peptide content, and controlled cold storage — all apply.",
      },
      {
        type: "p",
        text: "Following consistent handling protocols keeps these research inputs well-characterized from delivery through experimentation.",
      },
    ],
    takeaways: [
      "GLP-1 research peptides are RUO compounds studied for their incretin-receptor targeting.",
      "The class spans single-, dual-, and triple-receptor designs: semaglutide, tirzepatide, retatrutide.",
      "Receptor profile (GLP-1, GIP, glucagon) defines the signaling pathways under study.",
      "Structural complexity makes verified purity and a batch-specific COA essential for this category.",
    ],
    faqs: [
      {
        q: "What are GLP-1 research peptides?",
        a: "They are synthetic Research Use Only peptides designed to interact with the GLP-1 receptor and, in some cases, additional incretin receptors, studied as tools in receptor-signaling and pharmacology research.",
      },
      {
        q: "How do tirzepatide, semaglutide, and retatrutide differ?",
        a: "They differ by receptor targets: semaglutide is studied as a single GLP-1 target, tirzepatide as a dual GIP/GLP-1 target, and retatrutide as a triple GLP-1/GIP/glucagon target.",
      },
      {
        q: "Why is purity especially important for GLP-1 class peptides?",
        a: "These are structurally complex modified peptides, so minor impurities can affect research results. A batch-specific COA with HPLC purity and MS identity is essential for reproducibility.",
      },
    ],
  },
];

export const getPost = (slug: string) => posts.find((p) => p.slug === slug);

export const recentPosts = (n = 3) =>
  [...posts].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, n);
