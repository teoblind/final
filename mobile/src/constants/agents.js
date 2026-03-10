export const AGENTS = [
  {
    id: 'hivemind', name: 'DACP Agent', initial: 'D', color: '#3b82f6', bgColor: '#111827',
    description: 'Central intelligence — routes tasks, answers questions, coordinates agents',
    status: 'Always on',
    capabilities: ['Route tasks', 'Knowledge base', 'Email management', 'Workspace tools'],
  },
  {
    id: 'estimating', name: 'Estimating Bot', initial: 'E', color: '#1e3a5f', bgColor: '#e8eef5',
    description: 'Parse bid requests, generate estimates, draft response emails',
    status: 'Online', statusDetail: '8 RFQs',
    capabilities: ['Parse RFQs', 'Generate estimates', 'Price references', 'Bid emails'],
  },
  {
    id: 'documents', name: 'Documents', initial: 'D', color: '#7c3aed', bgColor: '#f3eeff',
    description: 'Process PDFs, extract data from drawings, search file library',
    status: 'Online',
    capabilities: ['Process PDFs', 'Extract data', 'Search library', 'Organize files'],
  },
  {
    id: 'meetings', name: 'Meeting Bot', initial: 'M', color: '#1a6b3c', bgColor: '#edf7f0',
    description: 'Search transcripts, summarize calls, track action items',
    status: 'Online',
    capabilities: ['Search transcripts', 'Summarize calls', 'Track action items'],
  },
  {
    id: 'email', name: 'Email Agent', initial: 'E', color: '#f59e0b', bgColor: '#fdf6e8',
    description: 'Draft bid responses, follow up on RFQs, manage correspondence',
    status: 'Online',
    capabilities: ['Draft emails', 'Search inbox', 'Follow-ups', 'Templates'],
  },
];

export const getAgent = (id) => AGENTS.find(a => a.id === id) || AGENTS[0];
