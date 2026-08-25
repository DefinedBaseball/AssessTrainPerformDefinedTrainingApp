/*
 * colleges.seed.ts - curated Minnesota college baseball programs.
 *
 * Source: coach-supplied roster (school / division / baseball page). The
 * sheet also carried Conference and City columns; those have no column on
 * the College model, so they are deliberately NOT imported rather than
 * being stuffed into an existing field.
 *
 * Seeding is UPSERT-BY-NAME and non-destructive, so it is safe to re-run on
 * every deploy (which is what seed.prod.ts does):
 *   - a school that does not exist is created;
 *   - a school that DOES exist only has EMPTY fields filled in. A division
 *     or website a coach already set by hand is never overwritten, and
 *     logoUrl is never touched at all - this list carries no logos, so
 *     writing it would blank out uploaded crests.
 *
 * name is @unique on College, which is what makes the match reliable.
 */

export interface CollegeSeed {
  name: string;
  division: string;
  websiteUrl: string;
}

export const MN_COLLEGES: CollegeSeed[] = [
  // NCAA D1 (2)
  { name: "University of Minnesota", division: "NCAA D1", websiteUrl: "https://gophersports.com/sports/baseball" },
  { name: "University of St. Thomas", division: "NCAA D1", websiteUrl: "https://tommiesports.com/sports/baseball" },

  // NCAA D2 (8)
  { name: "Bemidji State University", division: "NCAA D2", websiteUrl: "https://bsubeavers.com/sports/baseball" },
  { name: "Concordia University, St. Paul", division: "NCAA D2", websiteUrl: "https://cspbears.com/sports/baseball" },
  { name: "Minnesota State University, Mankato", division: "NCAA D2", websiteUrl: "https://msumavericks.com/sports/baseball" },
  { name: "Southwest Minnesota State University", division: "NCAA D2", websiteUrl: "https://smsumustangs.com/sports/baseball" },
  { name: "St. Cloud State University", division: "NCAA D2", websiteUrl: "https://scsuhuskies.com/sports/baseball" },
  { name: "University of Minnesota Crookston", division: "NCAA D2", websiteUrl: "https://goldeneaglesports.com/sports/baseball" },
  { name: "University of Minnesota Duluth", division: "NCAA D2", websiteUrl: "https://umdbulldogs.com/sports/baseball" },
  { name: "Winona State University", division: "NCAA D2", websiteUrl: "https://winonastatewarriors.com/sports/baseball" },

  // NCAA D3 (17)
  { name: "Augsburg University", division: "NCAA D3", websiteUrl: "https://athletics.augsburg.edu/sports/baseball" },
  { name: "Bethany Lutheran College", division: "NCAA D3", websiteUrl: "https://blcvikings.com/sports/baseball" },
  { name: "Bethel University", division: "NCAA D3", websiteUrl: "https://athletics.bethel.edu/sports/baseball" },
  { name: "Carleton College", division: "NCAA D3", websiteUrl: "https://athletics.carleton.edu/sports/baseball" },
  { name: "College of St. Scholastica", division: "NCAA D3", websiteUrl: "https://csssaints.com/sports/baseball" },
  { name: "Concordia College", division: "NCAA D3", websiteUrl: "https://gocobbers.com/sports/bsb/index" },
  { name: "Crown College", division: "NCAA D3", websiteUrl: "https://athletics.crown.edu/sports/baseball" },
  { name: "Gustavus Adolphus College", division: "NCAA D3", websiteUrl: "https://gogusties.com/sports/baseball" },
  { name: "Hamline University", division: "NCAA D3", websiteUrl: "https://hamlineathletics.com/sports/baseball" },
  { name: "Macalester College", division: "NCAA D3", websiteUrl: "https://athletics.macalester.edu/sports/baseball" },
  { name: "Martin Luther College", division: "NCAA D3", websiteUrl: "https://mlcknights.com/sports/baseball" },
  { name: "North Central University", division: "NCAA D3", websiteUrl: "https://ncurams.com/sports/baseball" },
  { name: "Saint John's University", division: "NCAA D3", websiteUrl: "https://gojohnnies.com/sports/baseball" },
  { name: "Saint Mary's University of Minnesota", division: "NCAA D3", websiteUrl: "https://saintmaryssports.com/sports/baseball" },
  { name: "St. Olaf College", division: "NCAA D3", websiteUrl: "https://athletics.stolaf.edu/sports/baseball" },
  { name: "University of Minnesota Morris", division: "NCAA D3", websiteUrl: "https://morriscougars.com/sports/baseball" },
  { name: "University of Northwestern-St. Paul", division: "NCAA D3", websiteUrl: "https://unweagles.com/sports/baseball" },

  // NJCAA D3 (16)
  { name: "Alexandria Technical & Community College", division: "NJCAA D3", websiteUrl: "https://legends.alextech.edu/sports/bsb/index" },
  { name: "Anoka-Ramsey Community College", division: "NJCAA D3", websiteUrl: "https://arccgoldenrams.com/sports/bsb/index" },
  { name: "Central Lakes College", division: "NJCAA D3", websiteUrl: "https://clcraiders.com/sports/bsb/index" },
  { name: "Century College", division: "NJCAA D3", websiteUrl: "https://gowoodducks.com/sports/bsb/index" },
  { name: "Minnesota North College - Hibbing", division: "NJCAA D3", websiteUrl: "https://minnesotanorth.edu/athletics/" },
  { name: "Minnesota North College - Itasca", division: "NJCAA D3", websiteUrl: "https://minnesotanorth.edu/athletics/" },
  { name: "Minnesota North College - Mesabi Range", division: "NJCAA D3", websiteUrl: "https://minnesotanorth.edu/athletics/" },
  { name: "Minnesota North College - Rainy River", division: "NJCAA D3", websiteUrl: "https://minnesotanorth.edu/athletics/" },
  { name: "Minnesota North College - Vermilion", division: "NJCAA D3", websiteUrl: "https://minnesotanorth.edu/athletics/" },
  { name: "Minnesota State CTC - Fergus Falls", division: "NJCAA D3", websiteUrl: "https://athletics.minnesota.edu/sports/bsb/index" },
  { name: "Minnesota West Community & Technical College", division: "NJCAA D3", websiteUrl: "https://www.mnwestathletics.com/sports/bsb/index" },
  { name: "Northland Community & Technical College", division: "NJCAA D3", websiteUrl: "https://northlandpioneers.com/sports/baseball" },
  { name: "Ridgewater College", division: "NJCAA D3", websiteUrl: "https://ridgewaterathletics.com/sports/bsb/index" },
  { name: "Riverland Community College", division: "NJCAA D3", websiteUrl: "https://riverlandbluedevils.com/sports/bsb/index" },
  { name: "Rochester Community & Technical College", division: "NJCAA D3", websiteUrl: "https://www.rctcyellowjackets.com/sports/bsb/index" },
  { name: "St. Cloud Technical & Community College", division: "NJCAA D3", websiteUrl: "https://sctccathletics.com/sports/bsb/index" },

];

/**
 * Idempotently upsert MN_COLLEGES. Returns a tally so the caller can log
 * what actually changed rather than claiming a flat "seeded N".
 *
 * The client is typed as any so this module can be imported by both the
 * prod seed and a standalone runner without dragging in a PrismaClient
 * generic that differs between them.
 */
export async function seedColleges(prisma: any): Promise<{
  created: number; updated: number; unchanged: number;
}> {
  let created = 0, updated = 0, unchanged = 0;

  for (const c of MN_COLLEGES) {
    const existing = await prisma.college.findUnique({ where: { name: c.name } });

    if (!existing) {
      await prisma.college.create({
        data: { name: c.name, division: c.division, websiteUrl: c.websiteUrl },
      });
      created++;
      continue;
    }

    /* Fill only what is missing - never clobber a curated value. */
    const patch: Record<string, string> = {};
    if (!existing.division)   patch.division   = c.division;
    if (!existing.websiteUrl) patch.websiteUrl = c.websiteUrl;

    if (Object.keys(patch).length > 0) {
      await prisma.college.update({ where: { id: existing.id }, data: patch });
      updated++;
    } else {
      unchanged++;
    }
  }

  return { created, updated, unchanged };
}
