import { NextResponse } from 'next/server';
import connectDB from '../../../src/config/database';
import Influencer from '../../../src/models/Influencer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const sortMap = {
  newest: { updatedAt: -1 },
  oldest: { updatedAt: 1 },
  followersDesc: { followers: -1 },
  followersAsc: { followers: 1 },
  usernameAsc: { username: 1 },
  usernameDesc: { username: -1 }
};

export async function GET(request) {
  try {
    await connectDB();

    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q') || '';
    const sort = searchParams.get('sort') || 'newest';
    const page = Math.max(Number(searchParams.get('page') || 1), 1);
    const limit = Math.min(Math.max(Number(searchParams.get('limit') || 50), 1), 200);
    const skip = (page - 1) * limit;

    const query = { status: 'qualified' };

    if (q.trim()) {
      const regex = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [
        { username: regex },
        { bio: regex },
        { 'contacts.emails': regex },
        { 'contacts.phones': regex },
        { 'contacts.links': regex },
        { sourceBrand: regex }
      ];
    }

    const [leads, total] = await Promise.all([
      Influencer.find(query)
        .sort(sortMap[sort] || sortMap.newest)
        .skip(skip)
        .limit(limit)
        .lean(),
      Influencer.countDocuments(query)
    ]);

    return NextResponse.json({
      leads,
      total,
      page,
      limit,
      totalPages: Math.max(Math.ceil(total / limit), 1)
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    await connectDB();

    const body = await request.json();
    const deleteAll = body.deleteAll === true;

    if (deleteAll) {
      const result = await Influencer.deleteMany({ status: 'qualified' });
      return NextResponse.json({ deletedCount: result.deletedCount || 0 });
    }

    const ids = Array.isArray(body.ids) ? body.ids : [];

    if (ids.length === 0) {
      return NextResponse.json({ error: 'Informe os leads para excluir.' }, { status: 400 });
    }

    const result = await Influencer.deleteMany({ _id: { $in: ids } });

    return NextResponse.json({ deletedCount: result.deletedCount || 0 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
