// ============================================================
// LILAC - Recipe Data Layer (Firestore CRUD + local cache)
// ============================================================

// Local cache of all recipes (updated by real-time listener)
var allRecipes = [];
var unsubscribeRecipes = null;

// --- Start Real-Time Listener ---
function startRecipeListener() {
  if (unsubscribeRecipes) unsubscribeRecipes();
  unsubscribeRecipes = fbListenToRecipes(function(recipes) {
    allRecipes = recipes;
    onRecipesUpdated();
  });
}

function stopRecipeListener() {
  if (unsubscribeRecipes) {
    unsubscribeRecipes();
    unsubscribeRecipes = null;
  }
}

// Called whenever recipes change (re-render current view)
function onRecipesUpdated() {
  renderCurrentView();
}

// --- Recipe CRUD ---

function addRecipe(recipeData) {
  var user = getCurrentUser();
  recipeData.addedBy = user;
  recipeData.savedBy = [user]; // auto-save for the person who added it
  recipeData.ratings = {};
  recipeData.notes = {};
  recipeData.cookedBy = {};
  recipeData.dietary = recipeData.dietary || [];
  recipeData.ingredients = recipeData.ingredients || [];
  recipeData.instructions = recipeData.instructions || [];
  recipeData.tags = recipeData.tags || [];
  return fbAddRecipe(recipeData);
}

function updateRecipe(docId, updates) {
  return fbUpdateRecipe(docId, updates);
}

function deleteRecipe(docId) {
  return fbDeleteRecipe(docId);
}

function getRecipeById(docId) {
  for (var i = 0; i < allRecipes.length; i++) {
    if (allRecipes[i].id === docId) return allRecipes[i];
  }
  return null;
}

// --- Save/Unsave ---

function toggleSaveRecipe(docId) {
  var user = getCurrentUser();
  return fbToggleSave(docId, user);
}

function isRecipeSaved(recipe) {
  var user = getCurrentUser();
  return recipe.savedBy && recipe.savedBy.indexOf(user) >= 0;
}

// --- Rating ---

function rateRecipe(docId, rating) {
  var user = getCurrentUser();
  return fbSetRating(docId, user, rating);
}

function getMyRating(recipe) {
  var user = getCurrentUser();
  return (recipe.ratings && recipe.ratings[user]) || 0;
}

function getAvgRating(recipe) {
  if (!recipe.ratings) return 0;
  var keys = Object.keys(recipe.ratings);
  if (keys.length === 0) return 0;
  var sum = 0;
  keys.forEach(function(k) { sum += recipe.ratings[k]; });
  return sum / keys.length;
}

// --- Cooked ---

function markRecipeCooked(docId) {
  var user = getCurrentUser();
  return fbMarkCooked(docId, user);
}

function getMyCookedCount(recipe) {
  var user = getCurrentUser();
  return (recipe.cookedBy && recipe.cookedBy[user]) || 0;
}

function getTotalCookedCount(recipe) {
  if (!recipe.cookedBy) return 0;
  var total = 0;
  Object.keys(recipe.cookedBy).forEach(function(k) { total += recipe.cookedBy[k]; });
  return total;
}

// --- Notes ---

function setRecipeNotes(docId, notes) {
  var user = getCurrentUser();
  return fbSetNotes(docId, user, notes);
}

function getMyNotes(recipe) {
  var user = getCurrentUser();
  return (recipe.notes && recipe.notes[user]) || '';
}

// --- Filter & Search ---

function filterRecipes(recipes, filters) {
  return recipes.filter(function(r) {
    if (filters.search) {
      var q = filters.search.toLowerCase();
      var searchable = (r.title || '').toLowerCase() + ' ' +
        (r.cuisine || '').toLowerCase() + ' ' +
        (r.description || '').toLowerCase() + ' ' +
        (r.tags || []).join(' ').toLowerCase() + ' ' +
        (r.ingredients || []).join(' ').toLowerCase();
      if (searchable.indexOf(q) < 0) return false;
    }
    if (filters.cuisine && r.cuisine !== filters.cuisine) return false;
    if (filters.mealType && r.mealType !== filters.mealType) return false;
    if (filters.difficulty && r.difficulty !== filters.difficulty) return false;
    if (filters.gathering && r.gathering !== filters.gathering) return false;
    if (filters.dietary && filters.dietary.length > 0) {
      var rd = r.dietary || [];
      for (var i = 0; i < filters.dietary.length; i++) {
        if (rd.indexOf(filters.dietary[i]) < 0) return false;
      }
    }
    if (filters.prepTime) {
      var total = r.totalTime || r.prepTime || 0;
      if (filters.prepTime === 'quick' && total > 30) return false;
      if (filters.prepTime === 'medium' && (total <= 30 || total > 60)) return false;
      if (filters.prepTime === 'long' && total <= 60) return false;
    }
    if (filters.savedOnly) {
      if (!isRecipeSaved(r)) return false;
    }
    return true;
  });
}

function sortRecipes(recipes, sortBy) {
  var sorted = recipes.slice();
  switch (sortBy) {
    case 'newest':
      sorted.sort(function(a, b) {
        var da = a.dateAdded ? (a.dateAdded.toDate ? a.dateAdded.toDate() : new Date(a.dateAdded)) : new Date(0);
        var db2 = b.dateAdded ? (b.dateAdded.toDate ? b.dateAdded.toDate() : new Date(b.dateAdded)) : new Date(0);
        return db2 - da;
      });
      break;
    case 'rating':
      sorted.sort(function(a, b) { return getAvgRating(b) - getAvgRating(a); });
      break;
    case 'prepTime':
      sorted.sort(function(a, b) { return (a.totalTime || a.prepTime || 999) - (b.totalTime || b.prepTime || 999); });
      break;
    case 'mostCooked':
      sorted.sort(function(a, b) { return getTotalCookedCount(b) - getTotalCookedCount(a); });
      break;
    case 'title':
      sorted.sort(function(a, b) { return (a.title || '').localeCompare(b.title || ''); });
      break;
  }
  return sorted;
}

// --- Taste Profile ---

function buildTasteProfile() {
  var profile = {
    cuisineCounts: {},
    mealTypeCounts: {},
    ingredientCounts: {},
    dietaryCounts: {},
    totalRecipes: allRecipes.length,
    avgPrepTime: 0,
    topCuisines: [],
    topIngredients: []
  };

  var totalTime = 0;
  var timeCount = 0;

  allRecipes.forEach(function(r) {
    if (r.cuisine) {
      profile.cuisineCounts[r.cuisine] = (profile.cuisineCounts[r.cuisine] || 0) + 1;
    }
    if (r.mealType) {
      profile.mealTypeCounts[r.mealType] = (profile.mealTypeCounts[r.mealType] || 0) + 1;
    }
    if (r.dietary) {
      r.dietary.forEach(function(d) {
        profile.dietaryCounts[d] = (profile.dietaryCounts[d] || 0) + 1;
      });
    }
    if (r.ingredients) {
      r.ingredients.forEach(function(ing) {
        // Extract key ingredient words (skip measurements)
        var words = ing.toLowerCase().replace(/[0-9\/.,]+/g, '').trim().split(/\s+/);
        var key = words.slice(-2).join(' ').trim();
        if (key.length > 2) {
          profile.ingredientCounts[key] = (profile.ingredientCounts[key] || 0) + 1;
        }
      });
    }
    var t = r.totalTime || r.prepTime || 0;
    if (t > 0) {
      totalTime += t;
      timeCount++;
    }
  });

  profile.avgPrepTime = timeCount > 0 ? Math.round(totalTime / timeCount) : 0;

  // Top cuisines
  profile.topCuisines = Object.keys(profile.cuisineCounts)
    .sort(function(a, b) { return profile.cuisineCounts[b] - profile.cuisineCounts[a]; })
    .slice(0, 5);

  // Top ingredients
  profile.topIngredients = Object.keys(profile.ingredientCounts)
    .sort(function(a, b) { return profile.ingredientCounts[b] - profile.ingredientCounts[a]; })
    .slice(0, 10);

  return profile;
}

// --- Import from URL ---

function importRecipeFromUrl(urlOverride) {
  var urlInput = document.getElementById('recipe-url-input');
  var url = urlOverride || (urlInput ? urlInput.value.trim() : '');
  if (!url) return;

  var statusEl = document.getElementById('import-status');
  statusEl.className = 'import-status loading';
  statusEl.textContent = 'Importing recipe...';
  statusEl.classList.remove('hidden');

  var importBtn = document.getElementById('import-btn');
  if (importBtn) importBtn.disabled = true;

  fetch('/.netlify/functions/parse-recipe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: url })
  })
  .then(function(res) { return res.json(); })
  .then(function(data) {
    if (data.error) {
      statusEl.className = 'import-status error';
      statusEl.textContent = 'Error: ' + data.error;
      return;
    }
    statusEl.className = 'import-status success';
    statusEl.textContent = 'Recipe imported! Review and save below.';
    populateRecipeForm(data, url);
  })
  .catch(function(err) {
    statusEl.className = 'import-status error';
    statusEl.textContent = 'Failed to import. Try entering details manually.';
    console.error('Import error:', err);
  })
  .finally(function() {
    if (importBtn) importBtn.disabled = false;
  });
}

function populateRecipeForm(data, url) {
  setFormValue('recipe-title', data.title);
  setFormValue('recipe-description', data.description);
  setFormValue('recipe-image', data.image);
  setFormValue('recipe-prep-time', data.prepTime);
  setFormValue('recipe-cook-time', data.cookTime);
  setFormValue('recipe-servings', data.servings);
  setFormValue('recipe-cuisine', data.cuisine);
  setFormValue('recipe-meal-type', data.mealType);
  setFormValue('recipe-difficulty', data.difficulty);
  if (data.ingredients && data.ingredients.length) {
    setFormValue('recipe-ingredients', data.ingredients.join('\n'));
  }
  if (data.instructions && data.instructions.length) {
    setFormValue('recipe-instructions', data.instructions.join('\n'));
  }
  if (data.tags && data.tags.length) {
    setFormValue('recipe-tags', data.tags.join(', '));
  }
  // Store URL in a data attribute on the form
  var form = document.getElementById('add-recipe-form');
  if (form) form.dataset.recipeUrl = url || '';
  // Set dietary checkboxes
  if (data.dietary) {
    var checkboxes = document.querySelectorAll('#dietary-checkboxes input[type="checkbox"]');
    checkboxes.forEach(function(cb) {
      cb.checked = data.dietary.indexOf(cb.value) >= 0;
    });
  }
}

function setFormValue(id, value) {
  var el = document.getElementById(id);
  if (el && value !== undefined && value !== null) {
    el.value = value;
  }
}

function saveNewRecipe(event) {
  event.preventDefault();
  var form = document.getElementById('add-recipe-form');

  var dietary = [];
  var checkboxes = document.querySelectorAll('#dietary-checkboxes input[type="checkbox"]:checked');
  checkboxes.forEach(function(cb) { dietary.push(cb.value); });

  var ingredientsRaw = (document.getElementById('recipe-ingredients').value || '').trim();
  var instructionsRaw = (document.getElementById('recipe-instructions').value || '').trim();

  var recipeData = {
    url: form.dataset.recipeUrl || '',
    title: document.getElementById('recipe-title').value.trim(),
    description: document.getElementById('recipe-description').value.trim(),
    image: document.getElementById('recipe-image').value.trim(),
    prepTime: parseInt(document.getElementById('recipe-prep-time').value) || 0,
    cookTime: parseInt(document.getElementById('recipe-cook-time').value) || 0,
    totalTime: (parseInt(document.getElementById('recipe-prep-time').value) || 0) + (parseInt(document.getElementById('recipe-cook-time').value) || 0),
    servings: document.getElementById('recipe-servings').value.trim(),
    cuisine: document.getElementById('recipe-cuisine').value,
    mealType: document.getElementById('recipe-meal-type').value,
    difficulty: document.getElementById('recipe-difficulty').value,
    gathering: document.getElementById('recipe-gathering').value,
    dietary: dietary,
    ingredients: ingredientsRaw ? ingredientsRaw.split('\n').filter(function(l) { return l.trim(); }) : [],
    instructions: instructionsRaw ? instructionsRaw.split('\n').filter(function(l) { return l.trim(); }) : [],
    tags: document.getElementById('recipe-tags').value.split(',').map(function(t) { return t.trim(); }).filter(Boolean)
  };

  if (!recipeData.title) {
    showToast('Please enter a recipe title');
    return false;
  }

  addRecipe(recipeData).then(function() {
    showToast('Recipe saved!');
    closeAddRecipe();
    resetRecipeForm();
  }).catch(function(err) {
    showToast('Error saving recipe');
    console.error('Save error:', err);
  });

  return false;
}

function resetRecipeForm() {
  var form = document.getElementById('add-recipe-form');
  if (form) {
    form.reset();
    form.dataset.recipeUrl = '';
  }
  var status = document.getElementById('import-status');
  if (status) status.classList.add('hidden');
}
