// ============================================================
// LILAC - Recommendation Engine (AI-powered via Claude)
// ============================================================

var discoverSuggestions = [];
var discoverLoading = false;
var discoverError = '';

function renderDiscoverView() {
  var profile = buildTasteProfile();
  var html = '';

  // Header
  html += '<div class="discover-header">';
  html += '<h1>Discover Recipes</h1>';
  if (allRecipes.length > 0) {
    html += '<p>Based on your ' + profile.totalRecipes + ' saved recipes</p>';
  } else {
    html += '<p>Add some recipes to get personalized recommendations</p>';
  }
  html += '</div>';

  // Taste profile tags
  if (profile.topCuisines.length > 0 || profile.avgPrepTime > 0) {
    html += '<div class="taste-profile">';
    profile.topCuisines.forEach(function(c) {
      html += '<span class="taste-tag">' + escapeHtml(c) + '</span>';
    });
    if (profile.avgPrepTime > 0) {
      html += '<span class="taste-tag">~' + profile.avgPrepTime + ' min avg</span>';
    }
    html += '</div>';
  }

  // Action buttons
  html += '<div style="text-align:center;padding:0.75rem 1rem">';
  html += '<button class="btn btn-accent" onclick="fetchRecommendations()" ' + (discoverLoading ? 'disabled' : '') + '>';
  html += discoverLoading ? 'Finding recipes...' : (discoverSuggestions.length > 0 ? 'Get More Suggestions' : 'Get Suggestions');
  html += '</button>';
  html += '</div>';

  // Loading state
  if (discoverLoading) {
    html += '<div class="discover-loading">';
    html += '<div class="spinner"></div>';
    html += '<p>Finding recipes you\'ll love...</p>';
    html += '</div>';
  }

  // Error state
  if (discoverError) {
    html += '<div style="padding:1rem;text-align:center;color:var(--error)">' + escapeHtml(discoverError) + '</div>';
  }

  // Suggestions
  if (discoverSuggestions.length > 0 && !discoverLoading) {
    discoverSuggestions.forEach(function(s, idx) {
      html += renderSuggestionCard(s, idx);
    });
  }

  // Empty state if no recipes yet
  if (allRecipes.length === 0 && !discoverLoading) {
    html += renderEmptyState(
      'No recipes yet',
      'Add some recipes to your collection first, then come back for personalized suggestions!',
      '&#9733;'
    );
  }

  return html;
}

function renderSuggestionCard(suggestion, index) {
  var html = '<div class="suggestion-card">';
  html += '<h3>' + escapeHtml(suggestion.title) + '</h3>';
  if (suggestion.description) {
    html += '<p>' + escapeHtml(suggestion.description) + '</p>';
  }
  if (suggestion.whyYoullLikeIt) {
    html += '<div class="suggestion-why">"' + escapeHtml(suggestion.whyYoullLikeIt) + '"</div>';
  }
  html += '<div class="suggestion-meta">';
  if (suggestion.cuisine) html += '<span>' + escapeHtml(suggestion.cuisine) + '</span>';
  if (suggestion.prepTime) html += '<span>~' + suggestion.prepTime + ' min</span>';
  if (suggestion.difficulty) html += '<span>' + escapeHtml(suggestion.difficulty) + '</span>';
  html += '</div>';

  if (suggestion.ingredients && suggestion.ingredients.length > 0) {
    html += '<p style="font-size:0.8125rem;color:var(--text-muted);margin-bottom:0.75rem">';
    html += 'Key ingredients: ' + suggestion.ingredients.slice(0, 6).map(escapeHtml).join(', ');
    html += '</p>';
  }

  html += '<div class="suggestion-actions">';
  html += '<button class="btn btn-sm btn-accent" onclick="saveSuggestion(' + index + ')">Save to Collection</button>';
  html += '<button class="btn btn-sm btn-ghost" onclick="dismissSuggestion(' + index + ')">Not interested</button>';
  html += '</div>';
  html += '</div>';
  return html;
}

function fetchRecommendations() {
  if (allRecipes.length === 0) {
    showToast('Add some recipes first!');
    return;
  }

  discoverLoading = true;
  discoverError = '';
  renderCurrentView();

  var profile = buildTasteProfile();

  fetch('/.netlify/functions/lilac-recommend', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile: profile, count: 5 })
  })
  .then(function(res) { return res.json(); })
  .then(function(data) {
    discoverLoading = false;
    if (data.error) {
      discoverError = data.error;
    } else if (data.suggestions) {
      discoverSuggestions = data.suggestions;
    }
    renderCurrentView();
  })
  .catch(function(err) {
    discoverLoading = false;
    discoverError = 'Failed to get recommendations. Please try again.';
    renderCurrentView();
    console.error('Recommend error:', err);
  });
}

function saveSuggestion(index) {
  var s = discoverSuggestions[index];
  if (!s) return;

  var recipeData = {
    url: '',
    title: s.title || '',
    description: s.description || '',
    image: '',
    prepTime: parseInt(s.prepTime) || 0,
    cookTime: parseInt(s.cookTime) || 0,
    totalTime: (parseInt(s.prepTime) || 0) + (parseInt(s.cookTime) || 0),
    servings: s.servings || '',
    cuisine: s.cuisine || '',
    mealType: s.mealType || '',
    difficulty: s.difficulty || '',
    gathering: '',
    dietary: s.dietary || [],
    ingredients: s.ingredients || [],
    instructions: s.instructions || [],
    tags: ['ai-suggested']
  };

  addRecipe(recipeData).then(function() {
    showToast('"' + s.title + '" saved!');
    discoverSuggestions.splice(index, 1);
    renderCurrentView();
  }).catch(function(err) {
    showToast('Error saving recipe');
    console.error(err);
  });
}

function dismissSuggestion(index) {
  discoverSuggestions.splice(index, 1);
  renderCurrentView();
  if (discoverSuggestions.length === 0) {
    showToast('All suggestions reviewed!');
  }
}
