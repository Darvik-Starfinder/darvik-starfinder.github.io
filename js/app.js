// Configuration
const RELATIONSHIP_SCALE = {
  'despises': -3, 'hates': -2, 'dislikes': -1, 'neutral': 0,
  'likes': 1, 'likes_a_lot': 2, 'in_love_with': 3
};

const DB_PATH = 'data/network.sqlite';
let db = null;
let cy = null;
let isEditMode = false;

// Initialize
async function init() {
  db = await loadDatabase();
  const elements = await loadNetworkData();
  initializeGraph(elements);
  
  document.getElementById('toggle-edit').onclick = () => toggleEditMode();
  document.getElementById('add-char').onclick = () => addCharacterWizard();
  document.getElementById('download-db').onclick = () => downloadDatabase();
}

// Load SQLite database
async function loadDatabase() {
  const SQL = await initSqlJs({ locateFile: file => `js/${file}` });
  const response = await fetch(DB_PATH);
  const buffer = await response.arrayBuffer();
  return new SQL.Database(new Uint8Array(buffer));
}

// Load network data
function loadNetworkData() {
  const chars = db.exec("SELECT * FROM characters WHERE is_active = 1")[0];
  const rels = db.exec("SELECT * FROM relationships")[0];
  
  const nodes = chars.values.map(row => ({
    data: { id: row[0], label: row[1], color: row[2], group: row[4] }
  }));
  
  const edges = rels.values.map(row => ({
    data: { 
      id: `e${row[0]}`, source: row[1], target: row[2], 
      label: row[3], strength: row[4], notes: row[5] 
    }
  }));
  
  return { nodes, edges };
}

// Initialize Cytoscape
function initializeGraph(elements) {
  cy = cytoscape({
    container: document.getElementById('cy'),
    elements,
    style: [
      { selector: 'node', style: {
        'background-color': 'data(color)',
        'label': 'data(label)',
        'width': 35, 'height': 35,
        'font-size': '10px',
        'text-valign': 'bottom',
        'text-margin-y': '5px'
      }},
      { selector: 'edge', style: {
        'width': 2,
        'line-color': '#999',
        'target-arrow-color': '#999',
        'target-arrow-shape': 'triangle',
        'curve-style': 'bezier',
        'label': 'data(label)',
        'font-size': '8px',
        'text-rotation': 'autorotate',
        'text-margin-y': '-5px'
      }}
    ],
    layout: { name: 'cose', padding: 50 },
    minZoom: 0.5, maxZoom: 2
  });
  
  cy.on('tap', 'node', (e) => handleNodeClick(e.target));
}

// Handle node clicks (view vs edit mode)
function handleNodeClick(node) {
  if (isEditMode) {
    // Edit mode: start connection
    if (!window.selectedSource) {
      window.selectedSource = node;
      node.addClass('node-selected');
    } else {
      showRelationshipPicker(window.selectedSource, node);
      window.selectedSource.removeClass('node-selected');
      window.selectedSource = null;
    }
  } else {
    // View mode: highlight connections
    cy.elements().removeClass('edge-highlighted node-highlighted dimmed');
    const connected = node.connectedEdges().connectedNodes().add(node);
    cy.elements().not(connected).addClass('dimmed');
    node.addClass('node-highlighted');
    node.connectedEdges().addClass('edge-highlighted');
  }
}

// Toggle edit mode
function toggleEditMode() {
  isEditMode = !isEditMode;
  document.getElementById('edit-status').textContent = isEditMode ? 'EDIT MODE' : 'View Mode';
  document.getElementById('edit-status').style.color = isEditMode ? '#d00' : '#090';
  if (!isEditMode && window.selectedSource) {
    window.selectedSource.removeClass('node-selected');
    window.selectedSource = null;
  }
}

// Relationship picker modal
function showRelationshipPicker(source, target) {
  const modal = document.getElementById('modal');
  modal.innerHTML = `
    <h3>Relationship: ${source.data('label')} → ${target.data('label')}</h3>
    <select id="rel-type">
      <option value="despises">Despises (-3)</option>
      <option value="hates">Hates (-2)</option>
      <option value="dislikes">Dislikes (-1)</option>
      <option value="neutral" selected>Neutral (0)</option>
      <option value="likes">Likes (+1)</option>
      <option value="likes_a_lot">Likes a lot (+2)</option>
      <option value="in_love_with">In love with (+3)</option>
    </select>
    <textarea id="rel-notes" placeholder="Context notes..." rows="3"></textarea>
    <div>
      <button onclick="saveRelationship('${source.id()}', '${target.id()}')">Save</button>
      <button onclick="closeModal()">Cancel</button>
    </div>
  `;
  modal.classList.remove('hidden');
}

function saveRelationship(sourceId, targetId) {
  const type = document.getElementById('rel-type').value;
  const notes = document.getElementById('rel-notes').value;
  const strength = RELATIONSHIP_SCALE[type];
  
  // Insert into in-memory DB
  db.run(
    "INSERT OR REPLACE INTO relationships (source_id, target_id, type, strength, notes) VALUES (?, ?, ?, ?, ?)",
    [sourceId, targetId, type, strength, notes]
  );
  
  closeModal();
  
  // Re-render graph (simple but works for small networks)
  const elements = loadNetworkData();
  cy.destroy();
  initializeGraph(elements);
}

function closeModal() {
  document.getElementById('modal').classList.add('hidden');
}

// Character wizard for bulk adding
function addCharacterWizard() {
  const name = prompt("Character name:");
  if (!name) return;
  
  const color = prompt("Color hex:", "#ffd700");
  const id = name.toLowerCase().replace(/\W+/g, '_');
  
  // Add character to DB
  db.run("INSERT INTO characters (id, name, color) VALUES (?, ?, ?)", [id, name, color]);
  
  // Get existing characters
  const chars = db.exec("SELECT id, name FROM characters WHERE id != ?", [id])[0].values;
  
  const modal = document.getElementById('modal');
  modal.innerHTML = `
    <h3>Set relationships for ${name}</h3>
    <p>Quick-set all, then adjust exceptions:</p>
    <button onclick="quickSetAll('${id}', chars, 'neutral')">All Neutral</button>
    <button onclick="quickSetAll('${id}', chars, 'likes')">All Like</button>
    <button onclick="quickSetAll('${id}', chars, 'dislikes')">All Dislike</button>
    <table id="wizard-table"></table>
    <button onclick="completeWizard('${id}', '${name}')">Complete & Download</button>
  `;
  modal.classList.remove('hidden');
  
  // Build table
  const table = document.getElementById('wizard-table');
  table.innerHTML = '<tr><th>Character</th><th>Relationship</th></tr>';
  chars.forEach(([charId, charName]) => {
    const row = table.insertRow();
    row.innerHTML = `
      <td>${charName}</td>
      <td>
        <select id="rel-${charId}">
          <option value="despises">Despises</option>
          <option value="hates">Hates</option>
          <option value="dislikes">Dislikes</option>
          <option value="neutral" selected>Neutral</option>
          <option value="likes">Likes</option>
          <option value="likes_a_lot">Likes a lot</option>
          <option value="in_love_with">In love</option>
        </select>
      </td>
    `;
  });
}

function completeWizard(id, name) {
  // Insert all outgoing relationships
  const chars = db.exec("SELECT id FROM characters WHERE id != ?", [id])[0].values;
  chars.forEach(([targetId]) => {
    const type = document.getElementById(`rel-${targetId}`).value;
    const strength = RELATIONSHIP_SCALE[type];
    db.run(
      "INSERT INTO relationships (source_id, target_id, type, strength) VALUES (?, ?, ?, ?)",
      [id, targetId, type, strength]
    );
  });
  
  closeModal();
  downloadDatabase();
  alert(`✅ Added ${name}!\n\n1. Save the downloaded file\n2. Replace data/network.sqlite\n3. git add/commit/push`);
}

// Download updated database
function downloadDatabase() {
  const data = db.export();
  const blob = new Blob([data], {type: 'application/x-sqlite3'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `network-${Date.now()}.sqlite`;
  a.click();
  URL.revokeObjectURL(url);
}

// Start the app
init();