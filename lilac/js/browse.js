// ============================================================
// LILAC - Browse View (Filtering, Search, Sorting)
// ============================================================

var browseFilters = {
  search: '',
  cuisine: '',
  mealType: '',
  difficulty: '',
  gathering: '',
  dietary: [],
  prepTime: ''
};

var browseSort = 'newest';
var activeFilterDropdown = null;

// Filter options
var FILTER_OPTIONS = {
  cuisine: {
    label: 'Cuisine',
    options: ['American', 'Asian', 'Caribbean', 'Chinese', 'French', 'Greek', 'Indian', 'Italian', 'Japanese', 'Korean', 'Mediterranean', 'Mexican', 'Middle Eastern', 'Southern', 'Thai', 'Vietnamese']
  },
  mealType: {
    label: 'Meal Type',
    options: [
      { value: 'breakfast', label: 'Breakfast' },
      { value: 'brunch', label: 'Brunch' },
      { value: 'lunch', label: 'Lunch' },
      { value: 'dinner', label: 'Dinner' },
      { value: 'snack', label: 'Snack' },
      { value: 'dessert', label: 'Dessert' },
      { value: 'appetizer', label: 'Appetizer' },
      { value: 'side', label: 'Side Dish' },
      { value: 'drink', label: 'Drink' }
    ]
  },
  prepTime: {
    label: 'Time',
    options: [
      { value: 'quick', label: 'Under 30 min' },
      { value: 'medium', label: '30-60 min' },
      { value: 'long', label: 'Over 60 min' }
    ]
  },
  difficulty: {
    label: 'Difficulty',
    options: [
      { value: 'easy', label: 'Easy' },
      { value: 'intermediate', label: 'Intermediate' },
      { value: 'advanced', label: 'Advanced' }
    ]
  },
  gathering: {
    label: 'Gathering',
    options: [
      { value: 'solo', label: 'Solo' },
      { value: 'couple', label: 'Couple' },
      { value: 'family', label: 'Family' },
      { value: 'party', label: 'Party / Crowd' }
    ]
  },
  dietary: {
    label: 'Dietary',
    options: [
      { value: 'vegetarian', label: 'Vegetarian' },
      { value: 'vegan', label: 'Vegan' },
      { value: 'gluten-free', label: 'Gluten-Free' },
      { value: 'dairy-free', label: 'Dairy-Free' },
      { value: 'keto', label: 'Keto' },
      { value: 'paleo', label: 'Paleo' },
      { value: 'nut-free', label: 'Nut-Free' },
      { value: 'low-carb', label: 'Low-Carb' }
    ]
  }
};

function renderBrowseView() {
  var filtered = filterRecipes(allRecipes, browseFilters);
  var sorted = sortRecipes(filtered, browseSort);
  var activeCount = countActiveFilters();

  var html = '<div class="browse-header">';

  // Search
  html += '<div class="browse-search">';
  html += '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
  html += '<input type="text" placeholder="Search recipes..." value="' + escapeHtml(browseFilters.search) + '" oninput="browseFilters.search=this.value;renderBrowseContent()" autocomplete="off">';
  if (browseFilters.search) {
    html += '<button class="close-btn" onclick="browseFilters.search=\'\';renderCurrentView()" style="width:24px;height:24px;font-size:1rem">&times;</button>';
  }
  html += '</div>';

  // Filter chips
  html += '<div class="filter-chips">';
  Object.keys(FILTER_OPTIONS).forEach(function(key) {
    var fo = FILTER_OPTIONS[key];
    var isActive = key === 'dietary' ? (browseFilters.dietary && browseFilters.dietary.length > 0) : !!browseFilters[key];
    var activeLabel = '';
    if (isActive) {
      if (key === 'dietary') {
        activeLabel = browseFilters.dietary.length + ' selected';
      } else {
        var opts = fo.options;
        if (typeof opts[0] === 'string') {
          activeLabel = browseFilters[key];
        } else {
          var match = opts.find(function(o) { return o.value === browseFilters[key]; });
          activeLabel = match ? match.label : browseFilters[key];
        }
      }
    }
    html += '<button class="filter-chip' + (isActive ? ' active' : '') + '" onclick="toggleFilterDropdown(\'' + key + '\', this)">';
    html += isActive ? escapeHtml(activeLabel) : fo.label;
    html += ' <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>';
    html += '</button>';
  });
  if (activeCount > 0) {
    html += '<button class="filter-chip" onclick="clearAllFilters()" style="color:var(--error)">Clear All &times;</button>';
  }
  html += '</div>';

  html += '</div>';

  // Sort bar
  html += '<div class="browse-sort">';
  html += '<span>' + sorted.length + ' recipe' + (sorted.length !== 1 ? 's' : '') + '</span>';
  html += '<div>';
  html += '<label>Sort: </label>';
  html += '<select onchange="browseSort=this.value;renderBrowseContent()">';
  html += '<option value="newest"' + (browseSort === 'newest' ? ' selected' : '') + '>Newest</option>';
  html += '<option value="title"' + (browseSort === 'title' ? ' selected' : '') + '>A-Z</option>';
  html += '<option value="rating"' + (browseSort === 'rating' ? ' selected' : '') + '>Rating</option>';
  html += '<option value="prepTime"' + (browseSort === 'prepTime' ? ' selected' : '') + '>Prep Time</option>';
  html += '<option value="mostCooked"' + (browseSort === 'mostCooked' ? ' selected' : '') + '>Most Cooked</option>';
  html += '</select></div></div>';

  // Recipe grid
  html += '<div id="browse-grid">';
  html += renderRecipeGrid(sorted);
  html += '</div>';

  return html;
}

function renderBrowseContent() {
  var filtered = filterRecipes(allRecipes, browseFilters);
  var sorted = sortRecipes(filtered, browseSort);
  var gridEl = document.getElementById('browse-grid');
  if (gridEl) {
    gridEl.innerHTML = renderRecipeGrid(sorted);
  }
}

function toggleFilterDropdown(filterKey, btnEl) {
  // Close existing dropdown
  closeFilterDropdown();

  if (activeFilterDropdown === filterKey) {
    activeFilterDropdown = null;
    return;
  }

  activeFilterDropdown = filterKey;
  var fo = FILTER_OPTIONS[filterKey];
  var dropdown = document.createElement('div');
  dropdown.className = 'filter-dropdown';
  dropdown.id = 'active-filter-dropdown';

  // Clear option
  var clearHtml = '<button class="filter-dropdown-item" onclick="clearFilter(\'' + filterKey + '\')">';
  clearHtml += '<span style="color:var(--text-muted)">All</span></button>';

  var optionsHtml = '';
  fo.options.forEach(function(opt) {
    var value = typeof opt === 'string' ? opt : opt.value;
    var label = typeof opt === 'string' ? opt : opt.label;
    var isSelected = filterKey === 'dietary'
      ? (browseFilters.dietary && browseFilters.dietary.indexOf(value) >= 0)
      : browseFilters[filterKey] === value;

    optionsHtml += '<button class="filter-dropdown-item' + (isSelected ? ' selected' : '') + '" onclick="setFilter(\'' + filterKey + '\',\'' + value + '\')">';
    if (isSelected) optionsHtml += '&#10003; ';
    optionsHtml += escapeHtml(label) + '</button>';
  });

  dropdown.innerHTML = clearHtml + optionsHtml;

  // Position relative to button
  btnEl.style.position = 'relative';
  btnEl.appendChild(dropdown);

  // Close on outside click
  setTimeout(function() {
    document.addEventListener('click', closeFilterDropdownOnOutside);
  }, 10);
}

function closeFilterDropdown() {
  var dd = document.getElementById('active-filter-dropdown');
  if (dd) dd.remove();
  activeFilterDropdown = null;
  document.removeEventListener('click', closeFilterDropdownOnOutside);
}

function closeFilterDropdownOnOutside(e) {
  var dd = document.getElementById('active-filter-dropdown');
  if (dd && !dd.contains(e.target)) {
    closeFilterDropdown();
  }
}

function setFilter(key, value) {
  if (key === 'dietary') {
    var idx = browseFilters.dietary.indexOf(value);
    if (idx >= 0) {
      browseFilters.dietary.splice(idx, 1);
    } else {
      browseFilters.dietary.push(value);
    }
  } else {
    browseFilters[key] = browseFilters[key] === value ? '' : value;
  }
  closeFilterDropdown();
  renderCurrentView();
}

function clearFilter(key) {
  if (key === 'dietary') {
    browseFilters.dietary = [];
  } else {
    browseFilters[key] = '';
  }
  closeFilterDropdown();
  renderCurrentView();
}

function clearAllFilters() {
  browseFilters = {
    search: '',
    cuisine: '',
    mealType: '',
    difficulty: '',
    gathering: '',
    dietary: [],
    prepTime: ''
  };
  renderCurrentView();
}

function countActiveFilters() {
  var count = 0;
  if (browseFilters.cuisine) count++;
  if (browseFilters.mealType) count++;
  if (browseFilters.difficulty) count++;
  if (browseFilters.gathering) count++;
  if (browseFilters.prepTime) count++;
  if (browseFilters.dietary && browseFilters.dietary.length > 0) count++;
  return count;
}
