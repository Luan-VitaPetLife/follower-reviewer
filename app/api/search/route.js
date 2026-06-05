import { NextResponse } from 'next/server';
import connectDB from '../../../src/config/database';
import Influencer from '../../../src/models/Influencer';
import scraperService from '../../../src/services/scraperService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const toBoolean = value => value === true || value === 'true';
const { runScraper, requestStop } = scraperService;

export async function POST(request) {
  try {
    const body = await request.json();
    const targetBrand = String(body.targetBrand || '').replace('@', '').trim();

    if (!targetBrand) {
      return NextResponse.json({ error: 'Informe o perfil da marca.' }, { status: 400 });
    }

    await connectDB();

    const leads = await runScraper(targetBrand, {
      maxBrandPosts: Number(body.maxBrandPosts || 5),
      maxLeadsPerRun: Number(body.maxLeadsPerRun || 50),
      sourceMode: body.sourceMode || 'comments',
      followerScanLimit: Number(body.followerScanLimit || 10000),
      minFollowers: Number(body.minFollowers || 200),
      maxFollowers: Number(body.maxFollowers || 5000),
      requireAnyContact: toBoolean(body.requireAnyContact),
      requireLink: toBoolean(body.requireLink),
      allowedLinkTypes: Array.isArray(body.allowedLinkTypes) ? body.allowedLinkTypes : [],
      niche: body.niche || 'all',
      failOnError: true
    });

    for (const lead of leads) {
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
    }

    return NextResponse.json({
      insertedCount: leads.length,
      leads
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    requestStop();
    return NextResponse.json({ stopRequested: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
