// https://developer.mozilla.org/en/docs/IndexedDB/Using_IndexedDB

// In the following line, you should include the prefixes of implementations you want to test.
window.indexedDB = window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB;
// DON'T use "var indexedDB = ..." if you're not in a function.
// Moreover, you may need references to some window.IDB* objects:
window.IDBTransaction = window.IDBTransaction || window.webkitIDBTransaction || window.msIDBTransaction;
window.IDBKeyRange = window.IDBKeyRange || window.webkitIDBKeyRange || window.msIDBKeyRange;
// (Mozilla has never prefixed these objects, so we don't need window.mozIDB*)



/*
Εδώ ένα καλό tutorial
http://code.tutsplus.com/tutorials/working-with-indexeddb--net-34673

*/

function DBISTORE(dbi, storename) { 
	this.dbi = dbi;
	this.storename = storename;
}

DBISTORE.prototype.put = function(obj) {
	var wait = new $.Deferred();
	var transaction = this.dbi.db.transaction([this.storename], 'readwrite');
	var store = transaction.objectStore(this.storename);
	var request = store.put(obj);
	request.onsuccess = function(e) { 
		wait.resolve();
	};
	request.onerror = function(e) { 
		wait.reject(e);
	}
	return wait;
};

DBISTORE.prototype.putMany = function(array) {
	var wait = new $.Deferred();
	var transaction = this.dbi.db.transaction([this.storename], 'readwrite');
	var store = transaction.objectStore(this.storename);
	store.onerror = function() { 
		debugger;
		transaction.abort();
		wait.reject();
	}
	var i = 0;
	
	function putNext() { 
		if(i > array.length - 1) {
			wait.resolve();
			return ;
		}
		var item = array[i++]; // αυξάνω το i
		//dlog('putting i=', i);
		store.put(item).onsuccess = putNext;
	}

	putNext(); // http://stackoverflow.com/a/13666741 
	
	return wait;
};

/*DBISTORE.prototype.putMany = function(array) {
	var wait = new $.Deferred();
	var nSuccess = 0;
	var nFail = 0;

	for(var i = 0; i < array.length; i++) { 
		var item = array[i];
		var transaction = this.dbi.db.transaction([this.storename], 'readwrite');
		var store = transaction.objectStore(this.storename);
		var request = store.put(item);

		request.onsuccess = function() { 
			nSuccess++;
			//dlog('successes: ', nSuccess);
			if(nSuccess >= array.length) { 
				wait.resolve();
			}
		}

		request.onerror = function() { 
			nFail++;
			//dlog('fails: ', nFails);
			wait.reject();
		}
	}

	return wait;
};*/

DBISTORE.prototype.clear = function(obj) {
	var wait = new $.Deferred();
	var transaction = this.dbi.db.transaction([this.storename], 'readwrite');
	var store = transaction.objectStore(this.storename);
	var request = store.clear();
	request.onsuccess = function(e) { 
		wait.resolve();
	};
	request.onerror = function(e) { 
		wait.reject(e);
	}
	return wait;
};

// Με .done() παίρνεις την list. Για κάθε item καλείται η testcallback() και αν επιστρέψεις true, το βάζει στην list, αλλιώς δεν το βάζει.
// (στην testcallback μπο)
DBISTORE.prototype.list = function(testcallback) {
	var usetestcallback = typeof testcallback !== 'undefined';
	var list = [];
	var wait = new $.Deferred();
	var transaction = this.dbi.db.transaction([this.storename], 'readonly');
	var store = transaction.objectStore(this.storename);
	var cursor = store.openCursor();
	cursor.onsuccess = function(e) { 
		var result = e.target.result;
		if(!result) {
			wait.resolve(list);
			return;
		}
		if(!usetestcallback || testcallback(result.value)) { 
			list.push(result.value);
		}
		result.continue();
	};
	return wait; // και πάρε το list με .done()
}

DBISTORE.prototype.find = function(indexname, value) {
	var list = [];
	var wait = new $.Deferred();
	var transaction = this.dbi.db.transaction([this.storename], 'readonly');
	var store = transaction.objectStore(this.storename);
	var index = store.index(indexname);
	var range = IDBKeyRange.bound(value, value);
	var request = index.openCursor(range);
	request.onsuccess = function(e) { 
		var cursor = e.target.result;
		if(cursor) { 
			list.push(cursor.value);
			cursor.continue();
		} else { 
			wait.resolve(list);
		}
	};
	request.onerror = function(e) { 
		wait.reject(e);
	}
	return wait;
};

DBISTORE.prototype.new = function(obj) {
	var dbi = this.dbi;
	if(typeof obj === 'undefined') obj = {};
	var ret = dbi.newStoreItem(this.storename, obj);
	return ret;
};

function DBI(dbname, dbversion) { 
	var dbi = this;
	dbi.db = null; // θα πάρει τιμή με την open()
	dbi.dbname = dbname;
	dbi.dbversion = dbversion;
	dbi.opened = new $.Deferred();   // Κάνε .done() για ό,τι θέλεις
	dbi.storedefs = {};  // each has name: { name: name, params: params, indexdefs: []  }
	dbi.storedefsarray = [];
	dbi.stores = {};
	dbi.ready = (!!window.indexedDB);
}

DBI.prototype.defineStore = function(storename, storeparams, indexdefs, itemdeffunction) {
	var dbi = this;
	if(typeof indexdefs == 'undefined') indexdefs = [];
	if(!$.isArray(indexdefs)) indexdefs = [ indexdefs ];
	if(typeof itemdeffunction == 'undefined') itemdeffunction = null;
	var os = { name: storename, params: storeparams, indexdefs: indexdefs, itemdef: itemdeffunction };
	dbi.storedefs[storename] = os;
	dbi.storedefsarray.push(storename);
	dbi.stores[storename] = new DBISTORE(dbi, storename);
}

DBI.prototype.defineStoreIndex = function(storename, indexName, indexKeyPath, indexParams) { 
	var dbi = this;
	var indexdef = { name: indexName, keyPath: indexKeyPath, params: indexParams}; 
	var storedef = dbi.storedefs[storename];
	storedef.indexdefs.push(indexdef);
}

DBI.prototype.defineStoreItem = function(storename, itemdeffunction) {
	var dbi = this;
	var storedef = dbi.storedefs[storename];
	storedef.itemdef = itemdeffunction;
};

DBI.prototype.newStoreItem = function(storename, obj) {
	var dbi = this;
	var storedef = dbi.storedefs[storename];
	var itemdeffunction = storedef.itemdef;
	if(itemdeffunction) {
		var ret = itemdeffunction();
		$.extend(ret, obj);
	} else {
		var ret = $.extend({}, obj);
	}
	return ret;
};

DBI.prototype.open = function() {
	var dbi = this;

	if(dbi.opened.state !== 'pending') dbi.opened = new $.Deferred();
	
	if(!dbi.ready) { 
		dbi.opened.reject(null, "Δεν υποστηρίζεται η λειτουργία IndexedDB στον browser σας!");
		return dbi.opened;
	}

  var request = indexedDB.open(dbi.dbname, dbi.dbversion);

  request.onupgradeneeded = function(e) {
    var db = e.target.result;

    // A versionchange transaction is started automatically.
    e.target.transaction.onerror = dbi.onerror;

    for(storename in dbi.storedefs) { 
    	var storedef = dbi.storedefs[storename];
	    if(db.objectStoreNames.contains(storedef.name)) {
	      db.deleteObjectStore(storedef.name);
	    }
    	var store = db.createObjectStore(storedef.name, storedef.params);
    	var itodel = [];
    	for(var i = 0; i < store.indexNames.length; i++) { 
    		itodel.push(store.indexNames[i]);
    	}
    	for(var i = 0; i < itodel.length; i++) store.deleteIndex(itodel[i]);

    	for(var i = 0; i < storedef.indexdefs.length; i++) { 
    		var indexdef = storedef.indexdefs[i];
    		try {
    			store.createIndex(indexdef.name, indexdef.keyPath, indexdef.params);
    		} catch(e) { 
    			dlog(e);
    			debugger;
    		}
    	}
    }
      
  };

  request.onsuccess = function(e) {
    dbi.db = e.target.result;
    dbi.opened.resolve(dbi.db); // για να το πάρουν όσοι έχουν κάνει dbi.opened.done()
  };

  request.onerror = function(e) { 
  	debugger;
  	dlog(e);
  	dbi.opened.reject(e, "Πρόβλημα στο άνοιγμα της βάσης");  // Θέλω να εμφανίσω το message του error
  }

  return dbi.opened;
};

DBI.prototype.close = function() { 
	var dbi = this;
	if(!dbi.db) return ;
	dbi.db.close();
}

DBI.prototype.onerror = function(e) { 
	alert('error - see console log');
	console.log(e);
}

DBI.prototype.transaction = function() { 
	var dbi = this;
	//var trans = dbi.db.transaction(dbi.storedefsarray, 'readwrite');
	var transaction = new DBITRANS(dbi);
	return transaction;
}

DBI.prototype.getAll = function(storename) {
	var dbi = this;
	var t = dbi.db.transaction( [storename], 'readwrite');
	var store = t.objectStore(storename);
	var cursor = store.openCursor();
	var list = [];
	var wait = new $.Deferred();
	cursor.onsuccess = function(e) { 
		var result = e.target.result;
		if(!result) {
			wait.resolve(list);
			return;
		}
		list.push(result.value);
		result.continue();
	};

	return wait; // και πάρε το list με .done()
}

DBI.prototype.put = function(storename, obj) { 
	var dbi = this;
	var t = dbi.db.transaction( [storename], 'readwrite');
	var store = t.objectStore(storename);
	var wait = new $.Deferred();
	var request = store.add(obj);
	request.onsuccess = function(e) { 
		wait.resolve(e);
	};
	request.onerror = function(e) { 
		wait.reject(e);
	};
	return wait;
}



function DBITRANS(dbi) { 
	this.dbi = dbi;
	this.transaction = dbi.db.transaction(dbi.storedefsarray, 'readwrite');
	this.stores = {};

	for(storename in dbi.storedefs) {
		this.stores[storename] = this[storename] = this.transaction.objectStore(storename);
	}
}

DBITRANS.prototype.put = function(storename, obj) {
	var store = this.stores[storename];
	var request = store.put(obj);
	var deferred = new $.Deferred();
	request.onsuccess = function(e) { deferred.resolve(e); }
	request.onerror = function(e) { deferred.reject(e); }
	return deferred;
}

DBITRANS.prototype.getall = function(storename) {
	var store = this.stores[storename];
	var request = store.openCursor(IDBKeyRange.lowerBound(0));
	var deferred = new $.Deferred();
	var objects = [];
	request.onsuccess = function(e) {
		var result = e.target.result;
		if(!!result === false) {
			deferred.resolve(objects);
		} 
		objects.push(result.value);
		result.continue();
	}
	request.onerror = function(e) { 
		deferred.reject(e); 
	}
	return deferred;
}





