'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AtSign,
  Cat,
  Database,
  Download,
  FileJson,
  FileSpreadsheet,
  FileText,
  Filter,
  Link as LinkIcon,
  Mail,
  Phone,
  Play,
  Square,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';

const linkTypeOptions = [
  { value: 'linktree', label: 'Linktree/Bio' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'threads', label: 'Threads' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'other', label: 'Outros' }
];

const defaultFilters = {
  targetBrand: 'cobasi',
  sourceMode: 'comments',
  maxBrandPosts: 5,
  followerScanLimit: 10000,
  maxLeadsPerRun: 50,
  minFollowers: 200,
  maxFollowers: 5000,
  requireAnyContact: true,
  requireLink: false,
  allowedLinkTypes: linkTypeOptions.map(option => option.value),
  niche: 'all'
};

const formatContacts = contacts => {
  const safeContacts = contacts || {};
  return {
    emails: safeContacts.emails || [],
    phones: safeContacts.phones || [],
    links: safeContacts.links || []
  };
};

const buildQuery = params => {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') searchParams.set(key, value);
  });
  return searchParams.toString();
};

export default function HomePage() {
  const [filters, setFilters] = useState(defaultFilters);
  const [leads, setLeads] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [leadSearch, setLeadSearch] = useState('');
  const [leadSort, setLeadSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [activeSection, setActiveSection] = useState('prospecting');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const totalContacts = useMemo(() => {
    return leads.reduce((total, lead) => {
      const contacts = formatContacts(lead.contacts);
      return total + contacts.emails.length + contacts.phones.length + contacts.links.length;
    }, 0);
  }, [leads]);

  const updateFilter = (key, value) => {
    setFilters(current => ({ ...current, [key]: value }));
  };

  const toggleLinkType = value => {
    setFilters(current => {
      const exists = current.allowedLinkTypes.includes(value);
      return {
        ...current,
        allowedLinkTypes: exists
          ? current.allowedLinkTypes.filter(item => item !== value)
          : [...current.allowedLinkTypes, value]
      };
    });
  };

  const loadLeads = async (overrides = {}) => {
    const nextPage = overrides.page ?? page;
    const nextPageSize = overrides.limit ?? pageSize;
    const query = buildQuery({
      q: overrides.q ?? leadSearch,
      sort: overrides.sort ?? leadSort,
      page: nextPage,
      limit: nextPageSize
    });
    const response = await fetch(`/api/leads?${query}`);
    const data = await response.json();
    if (data.leads) {
      setLeads(data.leads);
      setTotal(data.total || 0);
      setPage(data.page || nextPage);
      setPageSize(data.limit || nextPageSize);
      setTotalPages(data.totalPages || 1);
      setSelectedIds([]);
    }
  };

  useEffect(() => {
    loadLeads().catch(() => {});
  }, []);

  const handleSubmit = async event => {
    event.preventDefault();
    setLoading(true);
    setMessage('');
    setError('');

    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(filters)
      });

      const responseText = await response.text();
      let data;

      try {
        data = JSON.parse(responseText);
      } catch {
        throw new Error('A API retornou uma resposta inesperada. Veja o terminal para detalhes.');
      }

      if (!response.ok) {
        throw new Error(data.error || 'Nao foi possivel iniciar a busca.');
      }

      await loadLeads();
      setMessage(`${data.insertedCount || 0} leads qualificados encontrados nesta execucao.`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  const deleteLead = async id => {
    if (!window.confirm('Excluir este lead do banco de dados?')) return;

    const response = await fetch(`/api/leads/${id}`, { method: 'DELETE' });
    const data = await response.json();

    if (!response.ok) {
      setError(data.error || 'Nao foi possivel excluir o lead.');
      return;
    }

    setLeads(current => current.filter(lead => lead._id !== id));
    await loadLeads();
    setMessage('Lead excluido do banco de dados.');
  };

  const deleteSelected = async () => {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`Excluir ${selectedIds.length} leads do banco de dados?`)) return;

    const response = await fetch('/api/leads', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: selectedIds })
    });
    const data = await response.json();

    if (!response.ok) {
      setError(data.error || 'Nao foi possivel excluir os leads.');
      return;
    }

    setLeads(current => current.filter(lead => !selectedIds.includes(lead._id)));
    setSelectedIds([]);
    await loadLeads();
    setMessage(`${data.deletedCount || 0} leads excluidos do banco de dados.`);
  };

  const deleteAll = async () => {
    const confirmation = window.prompt('Digite EXCLUIR TODOS para apagar todos os leads qualificados do banco.');

    if (confirmation !== 'EXCLUIR TODOS') {
      return;
    }

    const response = await fetch('/api/leads', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deleteAll: true })
    });
    const data = await response.json();

    if (!response.ok) {
      setError(data.error || 'Nao foi possivel excluir todos os leads.');
      return;
    }

    await loadLeads({ page: 1 });
    setMessage(`${data.deletedCount || 0} leads excluidos do banco de dados.`);
  };

  const toggleSelected = id => {
    setSelectedIds(current => (
      current.includes(id) ? current.filter(item => item !== id) : [...current, id]
    ));
  };

  const exportLeads = format => {
    if (total === 0) return;
    window.open(`/api/export?format=${format}`, '_blank', 'noopener,noreferrer');
  };

  const stopSearch = async () => {
    setMessage('');
    setError('');

    try {
      await fetch('/api/search', { method: 'DELETE' });
      setMessage('Pedido de parada enviado. O sistema vai interromper na próxima etapa segura.');
    } catch {
      setError('Nao foi possivel enviar o pedido de parada.');
    }
  };

  const goToSection = sectionId => {
    setActiveSection(sectionId);
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const usesComments = filters.sourceMode === 'comments' || filters.sourceMode === 'both';
  const usesFollowers = filters.sourceMode === 'followers' || filters.sourceMode === 'both';

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <img src="/logo.png" alt="" onError={event => { event.currentTarget.style.display = 'none'; }} />
            <Cat size={21} />
          </div>
          <span>Coco and Luna</span>
        </div>

        <nav className="sidebar-nav" aria-label="Navegacao principal">
          <button className={`nav-item ${activeSection === 'prospecting' ? 'active' : ''}`} type="button" onClick={() => goToSection('prospecting')}>
            <Search size={17} />
            Prospecção
          </button>
          <button className={`nav-item ${activeSection === 'leads' ? 'active' : ''}`} type="button" onClick={() => goToSection('leads')}>
            <Database size={17} />
            Banco de leads
          </button>
          <button className={`nav-item ${activeSection === 'filters' ? 'active' : ''}`} type="button" onClick={() => goToSection('filters')}>
            <SlidersHorizontal size={17} />
            Filtros
          </button>
        </nav>

        <p className="sidebar-note">
          A busca por seguidores pode demorar bastante. Use uma margem menor para testar antes de procurar milhares de perfis.
        </p>
      </aside>

      <section className="main">
        <div className="topbar">
          <div className="title-block">
            <h1>Coco and Luna Leads</h1>
            <p>Busque por comentários, seguidores da marca ou ambos, com filtros comerciais configuráveis.</p>
          </div>

          <div className="status-pill">
            <Database size={16} />
            {total} leads · {totalContacts} contatos nesta página
          </div>
        </div>

        <div className="grid">
          <section className="panel" id="prospecting">
            <div className="panel-header">
              <h2>Configurar busca</h2>
              <p>Escolha a origem e os critérios da execução.</p>
            </div>

            <form className="form" onSubmit={handleSubmit}>
              <label className="field">
                <span>Perfil da marca</span>
                <input
                  value={filters.targetBrand}
                  onChange={event => updateFilter('targetBrand', event.target.value.replace('@', '').trim())}
                  placeholder="cobasi"
                />
              </label>

              <label className="field">
                <span>Origem dos possíveis leads</span>
                <select value={filters.sourceMode} onChange={event => updateFilter('sourceMode', event.target.value)}>
                  <option value="comments">Comentários dos posts</option>
                  <option value="followers">Lista de seguidores da marca</option>
                  <option value="both">Comentários e seguidores</option>
                </select>
              </label>

              <div id="filters" className="section-anchor" />

              {usesComments && (
                <label className="field">
                  <span>Posts da marca</span>
                  <input
                    min="1"
                    max="20"
                    type="number"
                    value={filters.maxBrandPosts}
                    onChange={event => updateFilter('maxBrandPosts', Number(event.target.value))}
                  />
                </label>
              )}

              {usesFollowers && (
                <label className="field">
                  <span>Ver até quantos seguidores</span>
                  <input
                    min="1"
                    inputMode="numeric"
                    type="number"
                    value={filters.followerScanLimit}
                    onChange={event => updateFilter('followerScanLimit', Number(event.target.value))}
                  />
                  <small className="field-help">Exemplo: 10000 significa abrir a lista e tentar carregar até 10.000 seguidores.</small>
                </label>
              )}

              <div className="two-col">
                <label className="field">
                  <span>Limite de perfis</span>
                  <input
                    min="1"
                    max="500"
                    type="number"
                    value={filters.maxLeadsPerRun}
                    onChange={event => updateFilter('maxLeadsPerRun', Number(event.target.value))}
                  />
                </label>

                <label className="field">
                  <span>Nicho</span>
                  <select value={filters.niche} onChange={event => updateFilter('niche', event.target.value)}>
                    <option value="all">Pet geral</option>
                    <option value="cats">Apenas gatos</option>
                    <option value="dogs">Apenas cães</option>
                  </select>
                </label>
              </div>

              <div className="two-col">
                <label className="field">
                  <span>Seguidores min.</span>
                  <input
                    min="0"
                    type="number"
                    value={filters.minFollowers}
                    onChange={event => updateFilter('minFollowers', Number(event.target.value))}
                  />
                </label>

                <label className="field">
                  <span>Seguidores max.</span>
                  <input
                    min="1"
                    type="number"
                    value={filters.maxFollowers}
                    onChange={event => updateFilter('maxFollowers', Number(event.target.value))}
                  />
                </label>
              </div>

              <div className="toggle-group">
                <label className="toggle-label">
                  <div>
                    <span>Exigir algum contato</span>
                    <small>E-mail, telefone ou link na bio.</small>
                  </div>
                  <input
                    type="checkbox"
                    checked={filters.requireAnyContact}
                    onChange={event => updateFilter('requireAnyContact', event.target.checked)}
                  />
                </label>

                <label className="toggle-label">
                  <div>
                    <span>Exigir link</span>
                    <small>Mais restritivo que qualquer contato.</small>
                  </div>
                  <input
                    type="checkbox"
                    checked={filters.requireLink}
                    onChange={event => updateFilter('requireLink', event.target.checked)}
                  />
                </label>
              </div>

              <div className="field">
                <span>Tipos de links permitidos</span>
                <div className="chip-grid">
                  {linkTypeOptions.map(option => (
                    <label className="chip-option" key={option.value}>
                      <input
                        checked={filters.allowedLinkTypes.includes(option.value)}
                        type="checkbox"
                        onChange={() => toggleLinkType(option.value)}
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="action-row">
                <button className="primary-button" disabled={loading} type="submit">
                  <Play size={18} />
                  {loading ? 'Executando busca...' : 'Iniciar busca'}
                </button>
                <button className="stop-button" disabled={!loading} type="button" onClick={stopSearch}>
                  <Square size={16} />
                  Parar
                </button>
              </div>
            </form>
          </section>

          <section className="panel result-panel" id="leads">
            <div className="panel-header">
              <h2>Leads qualificados</h2>
              <p>Pesquise, ordene, exclua e exporte leads salvos no MongoDB.</p>
            </div>

            <div className="toolbar">
              <label className="search-box">
                <Search size={15} />
                <input
                  value={leadSearch}
                  onChange={event => setLeadSearch(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') loadLeads({ q: leadSearch, page: 1 });
                  }}
                  placeholder="Pesquisar leads"
                />
              </label>

              <select
                value={leadSort}
                onChange={event => {
                  setLeadSort(event.target.value);
                  loadLeads({ sort: event.target.value, page: 1 });
                }}
              >
                <option value="newest">Mais recentes</option>
                <option value="oldest">Mais antigos</option>
                <option value="followersDesc">Mais seguidores</option>
                <option value="followersAsc">Menos seguidores</option>
                <option value="usernameAsc">A-Z</option>
                <option value="usernameDesc">Z-A</option>
              </select>

              <button className="icon-button" type="button" onClick={() => loadLeads()}>
                <RefreshCw size={16} />
              </button>

              <button className="danger-button" disabled={selectedIds.length === 0} type="button" onClick={deleteSelected}>
                <Trash2 size={16} />
                Excluir selecionados
              </button>
            </div>

            <div className="export-row">
              <select
                disabled={total === 0}
                value={pageSize}
                onChange={event => {
                  const limit = Number(event.target.value);
                  setPageSize(limit);
                  loadLeads({ page: 1, limit });
                }}
              >
                <option value="25">25 por página</option>
                <option value="50">50 por página</option>
                <option value="100">100 por página</option>
                <option value="200">200 por página</option>
              </select>
              <button type="button" disabled={total === 0} onClick={() => exportLeads('excel')}>
                <FileSpreadsheet size={15} />
                Excel
              </button>
              <button type="button" disabled={total === 0} onClick={() => exportLeads('csv')}>
                <Download size={15} />
                CSV
              </button>
              <button type="button" disabled={total === 0} onClick={() => exportLeads('pdf')}>
                <FileText size={15} />
                PDF
              </button>
              <button type="button" disabled={total === 0} onClick={() => exportLeads('json')}>
                <FileJson size={15} />
                JSON
              </button>
              <button className="danger-export" disabled={total === 0} type="button" onClick={deleteAll}>
                <Trash2 size={15} />
                Excluir todos
              </button>
            </div>

            {message && <p className="message">{message}</p>}
            {error && <p className="message error">{error}</p>}

            {leads.length === 0 ? (
              <div className="empty-state">
                <div>
                  <Filter size={32} />
                  <p>Nenhum lead carregado ainda.</p>
                </div>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="leads-table">
                  <thead>
                    <tr>
                      <th></th>
                      <th>Perfil</th>
                      <th>Seguidores</th>
                      <th>Contatos</th>
                      <th>Bio</th>
                      <th>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map(lead => {
                      const contacts = formatContacts(lead.contacts);

                      return (
                        <tr key={lead._id || lead.username}>
                          <td>
                            <input
                              checked={selectedIds.includes(lead._id)}
                              type="checkbox"
                              onChange={() => toggleSelected(lead._id)}
                            />
                          </td>
                          <td>
                            <div className="username">
                              <AtSign size={14} />
                              {lead.username}
                            </div>
                          </td>
                          <td>{lead.followers?.toLocaleString('pt-BR') || 0}</td>
                          <td>
                            <div className="contacts">
                              {contacts.emails.map(email => (
                                <span key={email}>
                                  <Mail size={13} /> {email}
                                </span>
                              ))}
                              {contacts.phones.map(phone => (
                                <span key={phone}>
                                  <Phone size={13} /> {phone}
                                </span>
                              ))}
                              {contacts.links.map(link => (
                                <span key={link}>
                                  <LinkIcon size={13} /> {link}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="bio">{lead.bio}</td>
                          <td>
                            <button className="icon-button danger" type="button" onClick={() => deleteLead(lead._id)}>
                              <Trash2 size={16} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {total > 0 && (
              <div className="pagination">
                <button
                  className="icon-button"
                  disabled={page <= 1}
                  type="button"
                  onClick={() => loadLeads({ page: page - 1 })}
                >
                  <ChevronLeft size={16} />
                </button>
                <span>Página {page} de {totalPages}</span>
                <button
                  className="icon-button"
                  disabled={page >= totalPages}
                  type="button"
                  onClick={() => loadLeads({ page: page + 1 })}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}
