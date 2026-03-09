// ============================================================
// LILAC - UI Components (Cards, Modals, Toasts, Detail View)
// ============================================================

// --- Recipe Card ---

function renderRecipeCard(recipe) {
  var saved = isRecipeSaved(recipe);
  var totalTime = recipe.totalTime || recipe.prepTime || 0;
  var timeStr = totalTime > 0 ? totalTime + ' min' : '';
  var rating = getAvgRating(recipe);

  var html = '<div class="recipe-card" onclick="openRecipeDetail(\'' + recipe.id + '\')">';
  html += '<div class="recipe-card-wrapper">';
  if (recipe.image) {
    html += '<img class="recipe-card-img" src="' + escapeHtml(recipe.image) + '" alt="' + escapeHtml(recipe.title) + '" loading="lazy" onerror="this.outerHTML=\'<div class=\\\'recipe-card-img-placeholder\\\'>&#127860;</div>\'">';
  } else {
    html += '<div class="recipe-card-img-placeholder">&#127860;</div>';
  }
  html += '<button class="recipe-card-save-btn' + (saved ? ' saved' : '') + '" onclick="event.stopPropagation();toggleSaveRecipe(\'' + recipe.id + '\')" title="' + (saved ? 'Unsave' : 'Save') + '">';
  html += saved ? '&#9829;' : '&#9825;';
  html += '</button>';
  html += '</div>';
  html += '<div class="recipe-card-body">';
  html += '<div class="recipe-card-title">' + escapeHtml(recipe.title || 'Untitled') + '</div>';
  html += '<div class="recipe-card-meta">';
  if (timeStr) html += '<span>&#9201; ' + timeStr + '</span>';
  if (recipe.cuisine) html += '<span class="recipe-card-badge">' + escapeHtml(recipe.cuisine) + '</span>';
  if (rating > 0) html += '<span>&#9733; ' + rating.toFixed(1) + '</span>';
  html += '</div>';
  if (recipe.addedBy) {
    html += '<div class="recipe-card-added-by">';
    html += '<span class="added-by"><span class="added-by-avatar">' + getUserInitial(recipe.addedBy) + '</span> ' + escapeHtml(recipe.addedBy) + '</span>';
    html += '</div>';
  }
  html += '</div></div>';
  return html;
}

function renderRecipeGrid(recipes) {
  if (!recipes || recipes.length === 0) {
    return renderEmptyState('No recipes found', 'Add your first recipe to get started!', '&#127859;');
  }
  var html = '<div class="recipe-grid">';
  recipes.forEach(function(r) {
    html += renderRecipeCard(r);
  });
  html += '</div>';
  return html;
}

function renderHorizontalScroll(recipes, maxItems) {
  var items = recipes.slice(0, maxItems || 8);
  if (items.length === 0) return '';
  var html = '<div class="horizontal-scroll">';
  items.forEach(function(r) {
    html += renderRecipeCard(r);
  });
  html += '</div>';
  return html;
}

// --- Recipe Detail ---

function openRecipeDetail(recipeId) {
  var recipe = getRecipeById(recipeId);
  if (!recipe) return;

  var overlay = document.getElementById('recipe-detail-overlay');
  var content = document.getElementById('recipe-detail-content');
  var myRating = getMyRating(recipe);
  var myNotes = getMyNotes(recipe);
  var totalTime = recipe.totalTime || recipe.prepTime || 0;
  var saved = isRecipeSaved(recipe);
  var cookedCount = getMyCookedCount(recipe);

  var html = '<div style="position:relative">';
  html += '<button class="recipe-detail-close" onclick="closeRecipeDetail()">&times;</button>';
  if (recipe.image) {
    html += '<img class="recipe-detail-hero" src="' + escapeHtml(recipe.image) + '" alt="' + escapeHtml(recipe.title) + '" onerror="this.outerHTML=\'<div class=\\\'recipe-detail-hero-placeholder\\\'>&#127860;</div>\'">';
  } else {
    html += '<div class="recipe-detail-hero-placeholder">&#127860;</div>';
  }
  html += '</div>';

  // Header
  html += '<div class="recipe-detail-header">';
  html += '<h2 class="recipe-detail-title">' + escapeHtml(recipe.title || 'Untitled') + '</h2>';
  if (recipe.description) {
    html += '<p class="recipe-detail-description">' + escapeHtml(recipe.description) + '</p>';
  }

  // Tags
  html += '<div class="recipe-detail-tags">';
  if (recipe.cuisine) html += '<span class="recipe-card-badge">' + escapeHtml(recipe.cuisine) + '</span>';
  if (recipe.mealType) html += '<span class="recipe-card-badge">' + escapeHtml(recipe.mealType) + '</span>';
  if (recipe.difficulty) html += '<span class="recipe-card-badge">' + escapeHtml(recipe.difficulty) + '</span>';
  if (recipe.gathering) html += '<span class="recipe-card-badge">' + escapeHtml(recipe.gathering) + '</span>';
  if (recipe.dietary) {
    recipe.dietary.forEach(function(d) {
      html += '<span class="recipe-card-badge">' + escapeHtml(d) + '</span>';
    });
  }
  html += '</div>';

  // Stats
  html += '<div class="recipe-detail-stats">';
  if (totalTime > 0) html += '<span class="recipe-detail-stat">&#9201; ' + totalTime + ' min</span>';
  if (recipe.prepTime) html += '<span class="recipe-detail-stat">Prep: ' + recipe.prepTime + 'min</span>';
  if (recipe.cookTime) html += '<span class="recipe-detail-stat">Cook: ' + recipe.cookTime + 'min</span>';
  if (recipe.servings) html += '<span class="recipe-detail-stat">&#127869; ' + escapeHtml(recipe.servings) + ' servings</span>';
  html += '</div>';

  // Added by
  html += '<div class="mt-1">';
  html += '<span class="added-by"><span class="added-by-avatar">' + getUserInitial(recipe.addedBy) + '</span> Added by ' + escapeHtml(recipe.addedBy || 'Unknown') + '</span>';
  if (recipe.savedBy && recipe.savedBy.length > 0) {
    html += ' &middot; <span class="text-muted" style="font-size:0.8125rem">Saved by ' + recipe.savedBy.map(escapeHtml).join(', ') + '</span>';
  }
  html += '</div>';
  html += '</div>';

  // Ingredients
  if (recipe.ingredients && recipe.ingredients.length > 0) {
    html += '<div class="recipe-detail-section">';
    html += '<h3>Ingredients</h3>';
    html += '<ul class="ingredient-list">';
    recipe.ingredients.forEach(function(ing, idx) {
      html += '<li class="ingredient-item">';
      html += '<input type="checkbox" class="ingredient-checkbox" onchange="this.nextElementSibling.classList.toggle(\'checked\')">';
      html += '<span class="ingredient-text">' + escapeHtml(ing) + '</span>';
      html += '</li>';
    });
    html += '</ul></div>';
  }

  // Instructions
  if (recipe.instructions && recipe.instructions.length > 0) {
    html += '<div class="recipe-detail-section">';
    html += '<h3>Instructions</h3>';
    html += '<ol class="instruction-list">';
    recipe.instructions.forEach(function(step, idx) {
      html += '<li class="instruction-item">';
      html += '<span class="instruction-step">' + (idx + 1) + '</span>';
      html += '<span class="instruction-text">' + escapeHtml(step) + '</span>';
      html += '</li>';
    });
    html += '</ol></div>';
  }

  // Rating & Notes
  html += '<div class="recipe-detail-section">';
  html += '<h3>Your Rating</h3>';
  html += '<div class="star-rating">';
  for (var i = 1; i <= 5; i++) {
    html += '<button class="star-btn' + (i <= myRating ? ' active' : '') + '" onclick="rateRecipe(\'' + recipe.id + '\',' + i + ');openRecipeDetail(\'' + recipe.id + '\')">&#9733;</button>';
  }
  html += '</div>';
  html += '<div class="mt-2">';
  html += '<h3>Your Notes</h3>';
  html += '<textarea id="recipe-notes-input" rows="3" placeholder="Add your notes...">' + escapeHtml(myNotes) + '</textarea>';
  html += '<button class="btn btn-sm btn-secondary mt-1" onclick="saveRecipeNotes(\'' + recipe.id + '\')">Save Notes</button>';
  html += '</div>';
  html += '</div>';

  // Source link
  if (recipe.url) {
    html += '<div class="recipe-detail-section">';
    html += '<a href="' + escapeHtml(recipe.url) + '" target="_blank" rel="noopener" class="btn btn-outline btn-sm">View Original Recipe &#8599;</a>';
    html += '</div>';
  }

  // Actions bar
  html += '<div class="recipe-actions">';
  html += '<button class="btn ' + (saved ? 'btn-accent' : 'btn-outline') + '" onclick="toggleSaveRecipe(\'' + recipe.id + '\');setTimeout(function(){openRecipeDetail(\'' + recipe.id + '\')},300)">' + (saved ? '&#9829; Saved' : '&#9825; Save') + '</button>';
  html += '<button class="btn btn-secondary" onclick="markRecipeCooked(\'' + recipe.id + '\');showToast(\'Marked as cooked!\');setTimeout(function(){openRecipeDetail(\'' + recipe.id + '\')},300)">&#127373; Cooked' + (cookedCount > 0 ? ' (' + cookedCount + ')' : '') + '</button>';
  html += '<button class="btn btn-ghost" onclick="confirmDeleteRecipe(\'' + recipe.id + '\')">&#128465;</button>';
  html += '</div>';

  content.innerHTML = html;
  overlay.classList.remove('hidden');
}

function closeRecipeDetail() {
  document.getElementById('recipe-detail-overlay').classList.add('hidden');
}

function saveRecipeNotes(recipeId) {
  var textarea = document.getElementById('recipe-notes-input');
  if (!textarea) return;
  setRecipeNotes(recipeId, textarea.value.trim()).then(function() {
    showToast('Notes saved');
  });
}

function confirmDeleteRecipe(recipeId) {
  if (confirm('Delete this recipe? This cannot be undone.')) {
    deleteRecipe(recipeId).then(function() {
      closeRecipeDetail();
      showToast('Recipe deleted');
    });
  }
}

// --- Add Recipe Modal ---

function openAddRecipe() {
  resetRecipeForm();
  document.getElementById('add-recipe-overlay').classList.remove('hidden');
  var urlInput = document.getElementById('recipe-url-input');
  if (urlInput) setTimeout(function() { urlInput.focus(); }, 300);
}

function closeAddRecipe() {
  document.getElementById('add-recipe-overlay').classList.add('hidden');
}

// --- Search Overlay ---

function openSearch() {
  document.getElementById('search-overlay').classList.remove('hidden');
  var input = document.getElementById('search-input');
  if (input) {
    input.value = '';
    setTimeout(function() { input.focus(); }, 300);
  }
  document.getElementById('search-results').innerHTML = '';
}

function closeSearch() {
  document.getElementById('search-overlay').classList.add('hidden');
}

function handleSearch(query) {
  var results = document.getElementById('search-results');
  if (!query || query.length < 2) {
    results.innerHTML = '';
    return;
  }
  var filtered = filterRecipes(allRecipes, { search: query });
  if (filtered.length === 0) {
    results.innerHTML = '<div class="empty-state" style="padding:2rem"><p>No recipes match "' + escapeHtml(query) + '"</p></div>';
    return;
  }
  var html = '';
  filtered.slice(0, 10).forEach(function(r) {
    html += '<div class="search-result-item" onclick="closeSearch();openRecipeDetail(\'' + r.id + '\')">';
    if (r.image) {
      html += '<img class="search-result-img" src="' + escapeHtml(r.image) + '" alt="" loading="lazy">';
    } else {
      html += '<div class="search-result-img" style="display:flex;align-items:center;justify-content:center">&#127860;</div>';
    }
    html += '<div class="search-result-info">';
    html += '<h4>' + escapeHtml(r.title) + '</h4>';
    html += '<p>' + [r.cuisine, r.mealType, (r.totalTime || r.prepTime ? (r.totalTime || r.prepTime) + ' min' : '')].filter(Boolean).join(' · ') + '</p>';
    html += '</div></div>';
  });
  results.innerHTML = html;
}

// --- Toast ---

function showToast(message) {
  var container = document.getElementById('toast-container');
  var toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(function() {
    toast.remove();
  }, 3000);
}

// --- Empty State ---

function renderEmptyState(title, message, icon) {
  var html = '<div class="empty-state">';
  if (icon) html += '<div class="empty-state-icon">' + icon + '</div>';
  html += '<h3>' + escapeHtml(title) + '</h3>';
  html += '<p>' + escapeHtml(message) + '</p>';
  html += '<button class="btn btn-accent" onclick="openAddRecipe()">Add Your First Recipe</button>';
  html += '</div>';
  return html;
}

// --- Loading Skeleton ---

function renderSkeletonGrid(count) {
  var html = '<div class="recipe-grid">';
  for (var i = 0; i < (count || 6); i++) {
    html += '<div class="skeleton-card">';
    html += '<div class="skeleton skeleton-img"></div>';
    html += '<div class="skeleton skeleton-text"></div>';
    html += '<div class="skeleton skeleton-text-sm"></div>';
    html += '</div>';
  }
  html += '</div>';
  return html;
}

// --- Utilities ---

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
