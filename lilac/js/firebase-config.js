// ============================================================
// LILAC - Firebase Configuration
// Replace the config below with your Firebase project config
// ============================================================

var FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// Initialize Firebase
var firebaseApp = firebase.initializeApp(FIREBASE_CONFIG);
var db = firebase.firestore();

// Firestore collection reference
var recipesCollection = db.collection('recipes');

// --- Firestore Helpers ---

function fbAddRecipe(recipeData) {
  recipeData.dateAdded = firebase.firestore.FieldValue.serverTimestamp();
  return recipesCollection.add(recipeData);
}

function fbUpdateRecipe(docId, updates) {
  return recipesCollection.doc(docId).update(updates);
}

function fbDeleteRecipe(docId) {
  return recipesCollection.doc(docId).delete();
}

function fbGetRecipe(docId) {
  return recipesCollection.doc(docId).get().then(function(doc) {
    if (doc.exists) {
      var data = doc.data();
      data.id = doc.id;
      return data;
    }
    return null;
  });
}

function fbGetAllRecipes() {
  return recipesCollection.orderBy('dateAdded', 'desc').get().then(function(snapshot) {
    var recipes = [];
    snapshot.forEach(function(doc) {
      var data = doc.data();
      data.id = doc.id;
      recipes.push(data);
    });
    return recipes;
  });
}

// Real-time listener - calls callback with full recipe array on any change
function fbListenToRecipes(callback) {
  return recipesCollection.orderBy('dateAdded', 'desc').onSnapshot(function(snapshot) {
    var recipes = [];
    snapshot.forEach(function(doc) {
      var data = doc.data();
      data.id = doc.id;
      recipes.push(data);
    });
    callback(recipes);
  }, function(error) {
    console.error('Firestore listener error:', error);
  });
}

// Toggle save/unsave for a user
function fbToggleSave(docId, userName) {
  return recipesCollection.doc(docId).get().then(function(doc) {
    if (!doc.exists) return;
    var data = doc.data();
    var savedBy = data.savedBy || [];
    var idx = savedBy.indexOf(userName);
    if (idx >= 0) {
      savedBy.splice(idx, 1);
    } else {
      savedBy.push(userName);
    }
    return recipesCollection.doc(docId).update({ savedBy: savedBy });
  });
}

// Update rating for a user
function fbSetRating(docId, userName, rating) {
  var update = {};
  update['ratings.' + userName] = rating;
  return recipesCollection.doc(docId).update(update);
}

// Update cooked count for a user
function fbMarkCooked(docId, userName) {
  return recipesCollection.doc(docId).get().then(function(doc) {
    if (!doc.exists) return;
    var data = doc.data();
    var cookedBy = data.cookedBy || {};
    cookedBy[userName] = (cookedBy[userName] || 0) + 1;
    return recipesCollection.doc(docId).update({ cookedBy: cookedBy });
  });
}

// Update notes for a user
function fbSetNotes(docId, userName, notes) {
  var update = {};
  update['notes.' + userName] = notes;
  return recipesCollection.doc(docId).update(update);
}
