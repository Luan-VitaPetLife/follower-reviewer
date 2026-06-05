import { NextResponse } from 'next/server';
import connectDB from '../../../../src/config/database';
import Influencer from '../../../../src/models/Influencer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(_request, { params }) {
  try {
    await connectDB();

    const { id } = await params;
    const deleted = await Influencer.findByIdAndDelete(id);

    if (!deleted) {
      return NextResponse.json({ error: 'Lead nao encontrado.' }, { status: 404 });
    }

    return NextResponse.json({ deleted: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}