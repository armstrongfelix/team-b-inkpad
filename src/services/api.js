const USE_MOCK = true;
function getMockDB() {
  const defaultDB = { users: [], notes: {}, tokens: {} };
  const db = localStorage.getItem('mock_notes_app_db');
  return db ? JSON.parse(db) : defaultDB;
}
function saveMockDB(db) { localStorage.setItem('mock_notes_app_db', JSON.stringify(db)); }
function generateToken() { return 'mock_' + Math.random().toString(36).substr(2, 16); }

const mockHandlers = {
  'POST /auth/signup': async (headers, query, body) => {
    const db = getMockDB();
    const { name, email, phone, password } = body;
    if (db.users.find(u => u.email === email)) throw { status: 400, message: 'Email already exists' };
    const newUser = { id: Date.now().toString(), name, email, phone, password };
    db.users.push(newUser);
    const token = generateToken();
    db.tokens[token] = newUser.id;
    db.notes[newUser.id] = [];
    saveMockDB(db);
    return { token, user: { id: newUser.id, name, email, phone } };
  },
  'POST /auth/login': async (headers, query, body) => {
    const db = getMockDB();
    const { email, password } = body;
    const user = db.users.find(u => u.email === email && u.password === password);
    if (!user) throw { status: 401, message: 'Invalid credentials' };
    let token = Object.keys(db.tokens).find(t => db.tokens[t] === user.id);
    if (!token) { token = generateToken(); db.tokens[token] = user.id; }
    saveMockDB(db);
    return { token, user: { id: user.id, name: user.name, email: user.email, phone: user.phone } };
  },
  'GET /auth/me': async (headers) => {
    const token = headers.Authorization?.replace('Bearer ', '');
    if (!token) throw { status: 401, message: 'No token' };
    const db = getMockDB();
    const userId = db.tokens[token];
    if (!userId) throw { status: 401, message: 'Invalid token' };
    const user = db.users.find(u => u.id === userId);
    if (!user) throw { status: 401, message: 'User not found' };
    return { user: { id: user.id, name: user.name, email: user.email, phone: user.phone } };
  },
  'GET /notes': async (headers, query) => {
    const token = headers.Authorization?.replace('Bearer ', '');
    if (!token) throw { status: 401 };
    const db = getMockDB();
    const userId = db.tokens[token];
    if (!userId) throw { status: 401 };
    let notes = db.notes[userId] || [];
    if (query.search) {
      const s = query.search.toLowerCase();
      notes = notes.filter(n => n.title?.toLowerCase().includes(s) || n.content?.toLowerCase().includes(s));
    }
    if (query.tag) notes = notes.filter(n => n.tags?.includes(query.tag));
    return { notes };
  },
  'GET /notes/:id': async (headers, params) => {
    const token = headers.Authorization?.replace('Bearer ', '');
    if (!token) throw { status: 401 };
    const db = getMockDB();
    const userId = db.tokens[token];
    if (!userId) throw { status: 401 };
    const note = db.notes[userId]?.find(n => n._id === params.id);
    if (!note) throw { status: 404, message: 'Note not found' };
    return { note };
  },
  'POST /notes': async (headers, query, body) => {
    const token = headers.Authorization?.replace('Bearer ', '');
    if (!token) throw { status: 401 };
    const db = getMockDB();
    const userId = db.tokens[token];
    if (!userId) throw { status: 401 };
    const newNote = {
      _id: Date.now().toString(),
      title: body.title || '',
      content: body.content || '',
      tags: body.tags || [],
      pinned: body.pinned || false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    db.notes[userId] = db.notes[userId] || [];
    db.notes[userId].push(newNote);
    saveMockDB(db);
    return { note: newNote };
  },
  'PUT /notes/:id': async (headers, body, params) => {
    const token = headers.Authorization?.replace('Bearer ', '');
    if (!token) throw { status: 401 };
    const db = getMockDB();
    const userId = db.tokens[token];
    if (!userId) throw { status: 401 };
    const notes = db.notes[userId] || [];
    const index = notes.findIndex(n => n._id === params.id);
    if (index === -1) throw { status: 404 };
    notes[index] = { ...notes[index], ...body, updatedAt: new Date().toISOString() };
    saveMockDB(db);
    return { note: notes[index] };
  },
  'PATCH /notes/:id/pin': async (headers, body, params) => {
    const token = headers.Authorization?.replace('Bearer ', '');
    if (!token) throw { status: 401 };
    const db = getMockDB();
    const userId = db.tokens[token];
    if (!userId) throw { status: 401 };
    const notes = db.notes[userId] || [];
    const index = notes.findIndex(n => n._id === params.id);
    if (index === -1) throw { status: 404 };
    notes[index].pinned = body.pinned;
    notes[index].updatedAt = new Date().toISOString();
    saveMockDB(db);
    return { note: notes[index] };
  },
  'DELETE /notes/:id': async (headers, body, params) => {
    const token = headers.Authorization?.replace('Bearer ', '');
    if (!token) throw { status: 401 };
    const db = getMockDB();
    const userId = db.tokens[token];
    if (!userId) throw { status: 401 };
    const newNotes = (db.notes[userId] || []).filter(n => n._id !== params.id);
    if ((db.notes[userId] || []).length === newNotes.length) throw { status: 404 };
    db.notes[userId] = newNotes;
    saveMockDB(db);
    return { success: true };
  },
};

async function realApi(path, options) {
  const BASE = import.meta.env.VITE_API_BASE_URL || 'https://notes-app-o9qs.onrender.com/api';
  const response = await fetch(`${BASE}${path}`, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(data.message || 'Request failed'); error.status = response.status; throw error; }
  return data;
}

export async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = localStorage.getItem('token');
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const options = { method, headers, body: body ? JSON.stringify(body) : undefined };
  if (USE_MOCK) {
    const key = `${method} ${path}`;
    let handler = mockHandlers[key];
    if (!handler && method === 'GET' && path.startsWith('/notes/')) {
      const id = path.split('/')[2];
      handler = mockHandlers['GET /notes/:id'];
      if (handler) return handler(headers, { id }, body);
    }
    if (!handler && method === 'PUT' && path.startsWith('/notes/')) {
      const id = path.split('/')[2];
      handler = mockHandlers['PUT /notes/:id'];
      if (handler) return handler(headers, body, { id });
    }
    if (!handler && method === 'PATCH' && path.includes('/pin')) {
      const id = path.split('/')[2];
      handler = mockHandlers['PATCH /notes/:id/pin'];
      if (handler) return handler(headers, body, { id });
    }
    if (!handler && method === 'DELETE' && path.startsWith('/notes/')) {
      const id = path.split('/')[2];
      handler = mockHandlers['DELETE /notes/:id'];
      if (handler) return handler(headers, body, { id });
    }
    if (handler) {
      let query = {};
      if (method === 'GET' && path.includes('?')) {
        const queryString = path.split('?')[1];
        const params = new URLSearchParams(queryString);
        for (let [k, v] of params.entries()) query[k] = v;
      }
      return handler(headers, query, body);
    }
    console.warn(`No mock handler for ${method} ${path}, falling back to real API`);
    return realApi(path, options);
  }
  return realApi(path, options);
}