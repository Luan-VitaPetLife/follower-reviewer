import { NextResponse } from 'next/server';
import connectDB from '../../../src/config/database';
import Influencer from '../../../src/models/Influencer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const escapeCsv = value => {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
};

const flattenLead = lead => {
  const contacts = lead.contacts || {};
  return {
    username: lead.username || '',
    followers: lead.followers || 0,
    emails: (contacts.emails || []).join(' | '),
    phones: (contacts.phones || []).join(' | '),
    links: (contacts.links || []).join(' | '),
    sourceBrand: lead.sourceBrand || '',
    bio: lead.bio || ''
  };
};

const createCsv = leads => {
  const headers = ['username', 'followers', 'emails', 'phones', 'links', 'sourceBrand', 'bio'];
  const rows = leads.map(lead => {
    const flat = flattenLead(lead);
    return headers.map(header => escapeCsv(flat[header])).join(',');
  });

  return [headers.join(','), ...rows].join('\r\n');
};

const createPdf = leads => {
  const lines = [
    'Pet Leads - Lista de leads',
    `Total: ${leads.length}`,
    '',
    ...leads.flatMap(lead => {
      const flat = flattenLead(lead);
      return [
        `@${flat.username} - ${flat.followers} seguidores`,
        `Emails: ${flat.emails || '-'}`,
        `Telefones: ${flat.phones || '-'}`,
        `Links: ${flat.links || '-'}`,
        `Origem: ${flat.sourceBrand || '-'}`,
        ''
      ];
    })
  ];

  const content = lines
    .slice(0, 180)
    .map((line, index) => `BT /F1 10 Tf 40 ${780 - (index % 70) * 11} Td (${String(line).replace(/[()\\]/g, '')}) Tj ET`)
    .join('\n');

  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj',
    '4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
    `5 0 obj << /Length ${Buffer.byteLength(content)} >> stream\n${content}\nendstream endobj`
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];

  objects.forEach(object => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${object}\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach(offset => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf);
};

export async function GET(request) {
  try {
    await connectDB();

    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format') || 'csv';
    const leads = await Influencer.find({ status: 'qualified' }).sort({ updatedAt: -1 }).limit(2000).lean();

    if (format === 'json') {
      return NextResponse.json({ leads });
    }

    if (format === 'pdf') {
      const pdf = createPdf(leads);
      return new NextResponse(pdf, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'attachment; filename="pet-leads.pdf"'
        }
      });
    }

    const csv = createCsv(leads);
    return new NextResponse(csv, {
      headers: {
        'Content-Type': format === 'excel' ? 'application/vnd.ms-excel; charset=utf-8' : 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="pet-leads.${format === 'excel' ? 'xls' : 'csv'}"`
      }
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
