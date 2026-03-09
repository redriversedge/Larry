// ============================================================
// LILAC - Core App (State, Navigation, Init)
// ============================================================

var currentTab = 'home';

// --- Navigation ---

function navigate(tab) {
  currentTab = tab;

  // Update nav active state
  var navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(function(item) {
    if (item.getAttribute('data-tab') === tab) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  renderCurrentView();

  // Scroll to top
  window.scrollTo(0, 0);
}

function renderCurrentView() {
  var content = document.getElementById('main-content');
  if (!content) return;

  switch (currentTab) {
    case 'home':
      content.innerHTML = renderHomeView();
      break;
    case 'browse':
      content.innerHTML = renderBrowseView();
      break;
    case 'discover':
      content.innerHTML = renderDiscoverView();
      break;
    case 'collection':
      content.innerHTML = renderCollectionView();
      break;
    default:
      content.innerHTML = renderHomeView();
  }
}

// --- Home View ---

function renderHomeView() {
  var html = '';

  // Hero
  html += '<div class="home-hero">';
  html += '<h1>What should we cook?</h1>';
  html += '<p>Discover your next favorite recipe</p>';
  if (allRecipes.length > 0) {
    html += '<button class="shuffle-btn" onclick="shuffleRecipe()">';
    html += '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>';
    html += 'Surprise Me!</button>';
  }
  html += '</div>';

  // Quick filters
  if (allRecipes.length > 0) {
    html += '<div class="home-section">';
    html += '<div class="quick-filters">';
    html += '<button class="quick-filter" onclick="quickFilter(\'prepTime\',\'quick\')">Under 30 min</button>';
    html += '<button class="quick-filter" onclick="quickFilter(\'mealType\',\'dinner\')">Dinner</button>';
    html += '<button class="quick-filter" onclick="quickFilter(\'gathering\',\'family\')">Family</button>';
    html += '<button class="quick-filter" onclick="quickFilter(\'gathering\',\'party\')">Crowd Pleaser</button>';
    html += '<button class="quick-filter" onclick="quickFilter(\'mealType\',\'dessert\')">Dessert</button>';
    html += '<button class="quick-filter" onclick="quickFilter(\'difficulty\',\'easy\')">Easy</button>';
    html += '</div>';
    html += '</div>';
  }

  // Recently added
  if (allRecipes.length > 0) {
    html += '<div class="home-section">';
    html += '<div class="section-header">';
    html += '<h2>Recently Added</h2>';
    html += '<a href="#" onclick="event.preventDefault();navigate(\'browse\')">See all</a>';
    html += '</div>';
    var recent = sortRecipes(allRecipes, 'newest').slice(0, 8);
    html += renderHorizontalScroll(recent);
    html += '</div>';
  }

  // Saved by partner
  var user = getCurrentUser();
  if (user && allRecipes.length > 0) {
    var partnerRecipes = allRecipes.filter(function(r) {
      return r.addedBy && r.addedBy !== user;
    });
    if (partnerRecipes.length > 0) {
      var partnerName = partnerRecipes[0].addedBy;
      html += '<div class="home-section">';
      html += '<div class="section-header">';
      html += '<h2>' + escapeHtml(partnerName) + '\'s Picks</h2>';
      html += '</div>';
      html += renderHorizontalScroll(partnerRecipes.slice(0, 8));
      html += '</div>';
    }
  }

  // Top rated
  var rated = allRecipes.filter(function(r) { return getAvgRating(r) > 0; });
  if (rated.length > 0) {
    rated = sortRecipes(rated, 'rating');
    html += '<div class="home-section">';
    html += '<div class="section-header">';
    html += '<h2>Top Rated</h2>';
    html += '</div>';
    html += renderHorizontalScroll(rated.slice(0, 8));
    html += '</div>';
  }

  // Empty state
  if (allRecipes.length === 0) {
    html += renderEmptyState(
      'Welcome to Lilac!',
      'Start by adding a recipe link or entering one manually.',
      '&#127802;'
    );
  }

  return html;
}

// --- Collection View ---

function renderCollectionView() {
  var user = getCurrentUser();
  var saved = allRecipes.filter(function(r) {
    return isRecipeSaved(r);
  });
  var sorted = sortRecipes(saved, 'newest');

  var html = '';

  // Header with stats
  html += '<div class="collection-header">';
  html += '<h1>My Saved Recipes</h1>';
  html += '<div class="collection-stats">';
  html += '<div class="collection-stat"><span class="collection-stat-value">' + saved.length + '</span><span class="collection-stat-label">Saved</span></div>';

  // Most common cuisine
  var cuisineCounts = {};
  saved.forEach(function(r) {
    if (r.cuisine) cuisineCounts[r.cuisine] = (cuisineCounts[r.cuisine] || 0) + 1;
  });
  var topCuisine = Object.keys(cuisineCounts).sort(function(a, b) { return cuisineCounts[b] - cuisineCounts[a]; })[0];
  if (topCuisine) {
    html += '<div class="collection-stat"><span class="collection-stat-value">' + escapeHtml(topCuisine) + '</span><span class="collection-stat-label">Top Cuisine</span></div>';
  }

  // Total cooked
  var totalCooked = 0;
  saved.forEach(function(r) { totalCooked += getMyCookedCount(r); });
  html += '<div class="collection-stat"><span class="collection-stat-value">' + totalCooked + '</span><span class="collection-stat-label">Times Cooked</span></div>';
  html += '</div></div>';

  // Recipe grid
  if (sorted.length > 0) {
    html += renderRecipeGrid(sorted);
  } else {
    html += renderEmptyState(
      'No saved recipes yet',
      'Browse recipes and tap the heart to save them here.',
      '&#9825;'
    );
  }

  return html;
}

// --- Quick Filter ---

function quickFilter(key, value) {
  clearAllFilters();
  browseFilters[key] = value;
  navigate('browse');
}

// --- Shuffle / Random ---

function shuffleRecipe() {
  if (allRecipes.length === 0) return;
  var idx = Math.floor(Math.random() * allRecipes.length);
  openRecipeDetail(allRecipes[idx].id);
}

// --- Init ---

function initApp() {
  startRecipeListener();
  updateUserAvatar(getCurrentUser());
  renderCurrentView();
}

// Boot
(function() {
  var user = getCurrentUser();
  if (!user) {
    showAuthScreen();
  } else {
    updateUserAvatar(user);
    initApp();
  }
})();
