require('dotenv').config();

const connectDB = require('./config/database');
const { runScraper } = require('./services/scraperService');
const Influencer = require('./models/Influencer');

const main = async () => {
  await connectDB();

  const targetBrand = process.env.TARGET_BRAND || 'cobasi';
  const extractedLeads = await runScraper(targetBrand, {
    maxBrandPosts: Number(process.env.MAX_BRAND_POSTS || 5),
    maxLeadsPerRun: Number(process.env.MAX_LEADS_PER_RUN || 50),
    sourceMode: process.env.SOURCE_MODE || 'comments',
    followerScanLimit: Number(process.env.FOLLOWER_SCAN_LIMIT || 10000),
    minFollowers: Number(process.env.MIN_FOLLOWERS || 200),
    maxFollowers: Number(process.env.MAX_FOLLOWERS || 5000),
    requireAnyContact: process.env.REQUIRE_ANY_CONTACT !== 'false',
    requireLink: process.env.REQUIRE_LINK === 'true',
    allowedLinkTypes: String(process.env.ALLOWED_LINK_TYPES || '')
      .split(',')
      .map(item => item.trim())
      .filter(Boolean),
    niche: process.env.NICHE || 'all'
  });

  if (!extractedLeads || extractedLeads.length === 0) {
    console.log('\nNenhum lead novo, ativo ou qualificado foi encontrado nesta execucao.');
    process.exit(0);
  }

  console.log(`\nSalvando ${extractedLeads.length} novos leads qualificados no banco...`);

  for (const lead of extractedLeads) {
    try {
      await Influencer.findOneAndUpdate(
        { username: lead.username },
        {
          username: lead.username,
          followers: lead.followers,
          bio: lead.bio,
          contacts: lead.contacts,
          sourceBrand: lead.sourceBrand,
          status: 'qualified',
          discardReason: ''
        },
        { upsert: true, returnDocument: 'after' }
      );

      console.log(`Perfil @${lead.username} inserido/atualizado.`);
    } catch (error) {
      console.error(`Erro ao salvar @${lead.username}:`, error.message);
    }
  }

  console.log('Processo finalizado.');
  process.exit(0);
};

main();
