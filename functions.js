$(initialize); // θα τρέξει on page load

var pageEvents = {};
var lastHash = '';
var barcodeKeepFocusInterval = null;

var TERMINAL = readTerminal();

// var dbitem = { dt: '', t: 0 }; // dt=datetime  t=type 1=enter -1=exit
var activeMode = localStorage['activeMode'];
if(!activeMode) activeMode = 'enter';

var keepMode = localStorage['keepMode'];
if(!keepMode) keepMode = 'enter';

var shows = {};
var activeShowIds = {};
var allShowsCount = 0;

var switches = {
	 	'barcode_showid_seatid': '0'
	, 'barcode_transcode_showid_seatid': '1' 
	, 'barcodes_specific': '0' 
};

readShowsFromLocalStorage();
readSwitches();

var dbi = null;

var BARCODE_RESULT = {
		'BR_UNKNOWN_ERROR': 0
	,	'BR_OK': 1
	, 'BR_EXISTS': 2
	, 'BR_INVALID_LENGTH': 3
	, 'BR_INVALID_SHOW': 4
	, 'BR_INVALID_TRANSACTION': 5
	, 'BR_NOT_EXPECTED': 6
	, 'BR_NOT_INVALID_CONTENT': 7
}


function initDatabase() {
	dbi = new DBI('barcodes_database', 11); 
	//dbi.defineStore('entries', { autoIncrement: true});
	//dbi.defineStore('entries', { keyPath: 'datetime' });
	dbi.defineStore('entries', { keyPath: 'localid', autoIncrement: true });
	dbi.defineStoreItem('entries', function() { 
		return { barcode: '', inorout: 0, datetime: moment().format('YYYY-MM-DD HH:mm:ss'), barcodeterminalid : TERMINAL.id, serverid: 0 };
	});
	dbi.defineStoreIndex('entries', 'barcode', 'barcode', { unique: false } );
	dbi.defineStoreIndex('entries', 'datetime',  'datetime', { unique: false } );
}

function openDatabase() { 
	dbi.open();
	dbi.opened.done(function(db) { 
		//alert('Database opened!');
		//dlog(db);
	});
	dbi.opened.fail(function(e, msg) { 
		if(typeof msg !== undefined) {
			alert('Database failed to open :(\n' + msg);
		}
		dlog(e);
	});
	return dbi.opened; // αν θες να κάνεις κάτι με το done() fail() κτλ...
}

function checkAndStoreBarcode(barcode, inorout) {
	var wait = new $.Deferred();
	var item, lastitem;

	// debugging
	wait.done(function(result, item, lastitem) {
		dlog('result:',result,' item:',item,' lastitem:',lastitem); 
	});

	if(typeof inorout == 'undefined') inorout = 1; // in   (-1 είναι το out)

	//var item = dbi.newStoreItem('entries');
	item = dbi.stores.entries.new( { barcode: barcode, inorout: inorout} );

	function resolve(result) { 
		wait.resolve(result, item, lastitem);
	}

	// Πρώτα από όλα ελέγχουμε αν το barcode είναι από αυτά που δεχόμαστε.
	// ένα κριτήριο είναι να είναι τουλάχιστον 10 ψηφία
	if(barcode.length < 4) {
		resolve(BARCODE_RESULT.BR_INVALID_LENGTH);
		return wait;
	}

	// Αν μας έχουν πει να δεχόμαστε δεκαψήφια bacrodes ή μεγαλύτερα από δεκαψήφια, τότε ελέγχουμε κι αυτό το μέγεθος
	if(switches['barcode_showid_seatid'] == '1') { 
		if(barcode.length < 10) { 
			resolve(BARCODE_RESULT.BR_INVALID_LENGTH);
			return wait;
		}
	}

	if(switches['barcode_transcode_showid_seatid'] == '1' && switches['barcode_showid_seatid'] == '0') { 
		if(barcode.length < 13) { 
			resolve(BARCODE_RESULT.BR_INVALID_LENGTH);
			return wait;
		}
	}

	if(switches['barcode_transcode_showid_seatid'] == '1' || switches['barcode_showid_seatid'] == '1') { 
		// Και στις δυο αυτές περιπτώσεις, τα τελευταία πέντε ψηφία είναι η θέση (seatid), και τα πεντε επόμενα (από το τέλος) η παράσταση (showid)
		// Ελέγχω αν είναι από τις δεκτές παραστάσεις
		var sseatid = barcode.substr(barcode.length - 5, 5);
		var sshowid = barcode.substr(barcode.length - 10, 5);
		var seatid = sseatid * 1;
		var showid = sshowid * 1;
		if(isNaN(showid) || isNaN(seatid)) { 
			resolve(BARCODE_RESULT.BR_INVALID_CONTENT);
			return wait;
		}
		// Και ελέγχω αν το showid είναι στα ενεργά shows
		var isAnActiveShow = false;
		for(var i = 0; i < activeShowIds.length; i++) { 
			if(activeShowIds[i] == showid) { 
				isAnActiveShow = true;
				break;
			}
		}
		if(!isAnActiveShow) { 
			resolve(BARCODE_RESULT.BR_INVALID_SHOW);
			return wait;
		}

	}


	// Πρώτα το ψάχνουμε μήπως ήδη υπάρχει...
	var waitfind = dbi.stores.entries.find('barcode', barcode);
	waitfind.done(function(list) { 
		// To list περιέχει όσες εγγραφές έχουν γίνει για αυτό το barcode (είσοδοι/έξοδοι/κτλ)
		if(list.length == 0) {
			// Δεν υπάρχει  καθόλου στη λίστα
			//
			// TODO: Σε κάποιες περιπτώσεις μπορεί να θέλουμε να έχουμε εγγραφές ΑΝΑΜΟΝΗΣ (inorout=0) υποχρεωτικά
			//       Δηλαδή να περιμένουμε συγκεκριμένα barcodes.
			//       Εδώ θα γίνει αυτός ο έλεγχος, οπότε εφόσον ΔΕΝ υπάρχει σαν item στο list
			//       Τότε δεν το περιμένουμε και επιστρέφουμε αναλόγως
			// Προς το παρόν το έχω με false οπότε αυτός ο έλεγχος δεν γίνεται
			if(switches['barcodes_specific'] == '1') {
				resolve(BARCODE_RESULT.BR_NOT_EXPECTED);
				return ;
			}
			//
			// το εγγράφουμε τώρα.
			//
			//dlog('ΔΕΝ ΒΡΕΘΗΚΕ - ΕΛΕΓΧΟΥΜΕ ΑΝ ΕΙΝΑΙ ΔΕΚΤΟ ΚΑΙ ΚΑΤΑΧΩΡΟΥΜΕ');
			var putrequest = dbi.stores.entries.put(item);
			putrequest.done(function() { 
				resolve(BARCODE_RESULT.BR_OK);
			});
		} else { 
			// Ταξινομώ κατά ημερομηνία/ωρα καταχώρησης
			list.sort(function(i1, i2) { 
				if(i1.datetime < i2.datetime) return -1;
				if(i1.datetime > i2.datetime) return 1;
				return 0;
			});
			// Βρέθηκε. Μπορεί να είναι αρκετές εγγραφές. Κοιτάω μόνο την τελευταια. Θα το απορρίψω μόνο αν είναι ΕΙΣΟΔΟΣ (κι εγώ έχω ΕΙΣΟΔΟ επίσης), 
			// Δλδ αν είναι in (+1) και εμείς ζητάμε out (-1) τότε οκ. Αν είναι out (-1) κι εμείς ζητάμε in (+1), οκ. Αν είναι 0, ok
			lastitem = list[list.length - 1]; // το τελευταίο
			if(Number(lastitem.inorout) == 0 || Number(lastitem.inorout) !== Number(inorout)) { // ok
				dlog('ΟΚ - ΜΠΟΡΕΙ ΝΑ ΚΑΤΑΧΩΡΗΘΕΙ', list);
				var waitput = dbi.stores.entries.put(item);
				waitput.done(function() { 
					resolve(BARCODE_RESULT.BR_OK);
				});
			} else {
				// Πάει να περάσει δεύτερη φορά
				dlog('ΩΠΑ - ΔΕΝ ΕΠΙΤΡΕΠΕΤΑΙ', list);
				resolve(BARCODE_RESULT.BR_EXISTS);
			} 
		}
	});
	waitfind.fail(function(e) { 
		dlog('waitfind.failed: ', e);
		resolve(BARCODE_RESULT.BR_UNKNOWN_ERROR);
	});



	return wait;
}

function entryPut(obj) { 
	var wait = dbi.stores.entries.put(obj);
	wait.done(function() {
		dlog('ok');
	});
	wait.fail(function(e) { 
		dlog(e);
	});
	return wait;
}

function entriesPut(array) {

  // Χμ. Θέλω να καταχωρήσω μόνο αυτά που πρέπει να καταχωρηθου΄ν
  var items = [];
  for(var i = 0; i < array.length; i++) { 
  	var a = array[i];
 		var item = dbi.stores.entries.new( { barcode: a.barcode, inorout: a.inorout, serverid: a.serverid || 0, datetime: a.datetime, barcodeterminalid: (a.barcodeterminalid || 0) } );
 		items.push(item);
  }


	var wait = dbi.stores.entries.putMany(items);
	wait.done(function() {
		dlog('stored ' + items.length + ' items');
	});
	wait.fail(function(e) { 
		dlog('failed storing ' + items.length + ': ', e);
	});
	return wait;
}

function entriesLog(testcallback) { 
	var wait = dbi.stores.entries.list(testcallback);
	wait.done(function(list) {
		console.dir(list);
	});
	wait.fail(function(e) {
		//dlog(e);
	});
	return wait;
}

function entriesList(testcallback) { 
	var wait = dbi.stores.entries.list(testcallback);
	return wait;
}

// Διαγράφει όλη την βαση στο indexedDB - Αλλά:
// Αν του έχεις δώσει ένα onlybeforedatetime, θα κρατήσει όσες εγγραφές έχουν datetime >= από αυτό...
// Αυτό το κάνει διαγράφοντάς τα μεν όλα, και μετά ξανακαταχωρώντας αυτές τις εγγραφές.
function entriesClear(onlybeforetime) {
	if(typeof onlybeforetime == 'undefined') onlybeforetime = '';
	
	if(!onlybeforetime) {  
		var wait = dbi.stores.entries.clear();
		wait.done(function() {
			dlog('cleared all entries');
		});
		wait.fail(function(e) {
			dlog('failed to clear entries', e);
		});
		return wait;
	}

	dlog('Θα διαγράψω τα πάντα εκτός αν εχουν καταχωρηθεί μετά από ' + onlybeforetime);

	// Θα πάρω τα πιο πρόσφατα από το beforetime
	var wait = new $.Deferred();
	var keepEntries = [];

	var waitList = dbi.stores.entries.list(function(entry) { 
		if(entry.datetime < onlybeforetime) return false; // θα εξαιρεθεί από την keepEntries (άρα θα διαγραφεί)
		return true; // θα μπει στην keepEntries (αρα δεν θα διαγραφεί)
	});
	waitList.fail(function(e) { wait.reject(e) });
	waitList.done(function(list) { 
		keepEntries = list;
		if(keepEntries.length) { 
			dlog('Έχουν προκύψει ' + keepEntries.length + ' εγγραφές που καταχωρήθηκαν κατά το sync. Θα τις ξανακαταχωρήσω τοπικά: ', keepEntries);
		}
		// Τώρα τα διαγράφω όλα
		var clearWait = entriesClear(); // recursive χωρίς φιλτράρισμα
		clearWait.fail(function(e) { wait.reject(e) });
		clearWait.done(function() { 
			// σβήστηκαν. Ξανακαταχωρώ αυτά που είχα!
			dlog('Σβήστηκαν όλα τα τοπικά στοιχεία, οκ.');
			if(keepEntries.length == 0) { // Δεν έχω ενδιάμεσες εγγραφές που δεν ήθελα να κρατήσω 
				wait.resolve();
				return;
			}
			var putWait = entriesPut(keepEntries);
			putWait.fail(function(e) { dlog('ΩΧ ΠΡΟΒΛΗΜΑ ΣΤΗΝ ΕΠΑΝΑΤΟΠΟΘΕΤΗΣΗ', e); wait.reject(e); });
			putWait.done(function(e) { 
				dlog('Ξανα καταχωρήθηκαν οι ' + keepEntries.length + " εγγραφές που καταχωρήθηκαν εν τω μεταξύ: ", keepEntries);
				// Ξανακαταχωρήθηκαν!
				wait.resolve();
			});
		});
	});

	return wait;
}
// ************************************
// Αρχικοποιήσεις για τα διάφορα events
// ************************************

function initialize() { 
	moment.lang('el');

	initPages();
	initDatabase();
	openDatabase();

	$(window).on('hashchange', function() {
		hashChanged(); // το δίνω χωρίς το #
	});

	setActiveMode(activeMode);
	setKeepMode(keepMode);

	fillShowsInSetActiveShows();
	fillActiveShows();
	applySwitches(); // εχουν γίνει readSwitches στην αρχή...

	//bindPageEvent('settings', 'hide', function(evdata) { 
	//	evdata.allow = false;
	//});

	bindPageEvent('barcodes', 'enter', function() { 
		var page = getCurrentPage();
		if(!TERMINAL.id) { 
			page.addClass('terminalundefined').removeClass('terminaldefined');
		} else {
			page.removeClass('terminalundefined').addClass('terminaldefined');
		}

		$('#fldbarcode').focus();
		barcodeKeepFocusInterval = setInterval(function() {
			if(document.activeElement.id !== 'fldbarcode') { 
				$('#fldbarcode').focus();
			}
		}, 500);
	});

	bindPageEvent('barcodes', 'exit', function() { 
		clearInterval(barcodeKeepFocusInterval);
	});

	bindPageEvent('settings', 'enter', function(e) { 
		var page = e.page;
		if(!TERMINAL.id) { 
			page.removeClass('terminaldefined').addClass('terminalundefined');
		} else {
			page.addClass('terminaldefined').removeClass('terminalundefined');
			page.find('.terminalName').text(TERMINAL.name);
		}
	});

	bindPageEvent('defineterminal', 'enter', function(e) { 
		var page = e.page;
		var form = $('#defineterminal form')[0];
		form.elements.terminalcode.value = TERMINAL.code;
		if(TERMINAL.id) { 
			$('#defineterminal .msg').html('Τρέχον τερματικό:  <b>' + TERMINAL.name + '</b> (' + TERMINAL.code + ': ' + TERMINAL.id + ')');
		} else { 
			$('#defineterminal .msg').html('');
		}
	});

	bindPageEvent('setactiveshows', 'enter', function(e) { 
		adjustSetActiveShowsDimensions();
	});

	$('#defineterminal form').on('submit', function(e) {
		e.preventDefault();
		var terminalCode = this.elements.terminalcode.value;
		$('#defineterminal .msg').html('Παρακαλώ περιμένετε...');
		checkAndSetTerminal(terminalCode, function(result) { 
			if(result.status == 'error') { 
				$('#defineterminal .msg').html(result.msg).addClass('errortext');
			} else {
				$('#defineterminal .msg').html('Το τερματικό ορίστηκε επιτυχώς: <b>' + TERMINAL.name + '</b> (' + TERMINAL.code + ': ' + TERMINAL.id + ')').removeClass('errortext');
			}
		});


	});

	$('#btnbarcode').on('click', function() { 
		enterBarcode();
	});

	$('#fldbarcode').on('keydown', function(e) { 
		if(e.which == 13) { 
			e.preventDefault();
			enterBarcode();
		}
	});

	var lastnumber = 0;

	$('#barcodes .modes .mode').on('click', function(e) { 
		e.preventDefault();
		setActiveMode($(this).attr('data-mode'));
	});

	$('#barcodes .modes .keep').on('click', function(e) { 
		e.preventDefault();
		setKeepMode($(this).attr('data-mode'));
	});	

	$('#btnsynchronize').on('click', function(e) { 
		synchronize();
	});

	$('#loadshowsfromserver').on('click', function(e) { 
		e.preventDefault();
		loadShowsFromServer();
	});

	$(document).on('change', '#setactiveshows table tr.show td.check input', function(e) {
		e.preventDefault();
		var tr = $(this).closest('tr');
		var showid = tr.attr('data-showid');
		var show = shows[showid];
		if(show) { 
			show.active = !show.active;
			$(this).prop('checked', show.active);
			if(show.active) { tr.addClass('active'); } else { tr.removeClass('active'); }
			writeShowsToLocalStorage();
			readShowsFromLocalStorage();
			fillActiveShows();
		}
	});

	$(document).on('click', '#setactiveshows table tr.show td:not(".check")', function(e) {
		e.preventDefault();
		var tr = $(this).closest('tr');
		var check = tr.find('input');
		var showid = tr.attr('data-showid');
		var show = shows[showid];
		if(show) { 
			show.active = !show.active;
			check.prop('checked', show.active);
			if(show.active) { tr.addClass('active'); } else { tr.removeClass('active'); }
			writeShowsToLocalStorage();
			readShowsFromLocalStorage();
			fillActiveShows();
		}
	});

	$(document).on('change', '#setactiveshows table tr th.check input', function(e) {
		var active = $(this).prop('checked');
		$(this).prop('checked', active);
		for(var showid in shows) { 
			var show = shows[showid];
			show.active = active;
		}
		fillShowsInSetActiveShows();
		$('#setactiveshows table tr th.check input').prop('checked', active);
		writeShowsToLocalStorage();
		readShowsFromLocalStorage();
		fillActiveShows();
	});	

	$('input#onlyfutureshows').on('change', function(e) { 
		setOnlyFutureShows($(this).prop('checked'));
	});

	$(document).on('click', '.switch', function(e) { 
		e.preventDefault();
		e.stopPropagation();
		var a = $(this);
		var parent = a.closest('.switch_parent');
		var siblings = parent.find('.switch');
		siblings.removeClass('selected');
		a.addClass('selected');
		parent.attr('data-value', a.attr('data-value'));
		var settingName = parent.attr('data-field');
		var settingValue = parent.attr('data-value');
		setSwitch(settingName, settingValue);
	});

	$(window).on('resize', function(e) { 
		if(getCurrentPageId() == 'setactiveshows') {
			adjustSetActiveShowsDimensions();
		}
	});


	hashChanged();

}
/*****************************
	end of initialize()
******************************/




function dlog() { 
	console.log.apply(console, Array.prototype.slice.call(arguments));
}

function readEntry(number) { 
	var str = localStorage[number];
	var entry = [];
	if(!str) return entry;
	entry = JSON.parse(str);
	return entry;
}

function writeEntry(number, entry) { 
	var str = JSON.stringify(entry);
	localStorage[number] = str;
}

function initPages() { 
	var pages = $('#pages > .page');
	pages.each(function() { 
		var page = $(this);
		var div = $("<div class='topbar'></div>");
		var pageid = page.attr('id');
		var pagename = page.attr('data-pagename');
		var html = '';
		var pageparent = page.attr('data-pageparent');
		while(pageparent) {
			if(html) html = ' &gt; ' + html;
			var pp = $('#' + pageparent);
			if(pp.length) { 
				html = "<a href='#" + pp.attr('id') + "'>" + pp.attr('data-pagename') + "</a>" + html;
				pageparent = pp.attr('data-pageparent');
			} else {
				break;
			}
		}
		if(html) html += " &gt; ";
		html += "<a href='#" + pageid + "'>" + pagename + "</a>";
		div.html(html);
		//div.html("<a href='#" + pageid + "'>" + pagename + "</a> - <a href='javascript:window.history.back();'>Επιστροφή</a>");
		page.prepend(div);

		bindPageEvent(pageid, 'enter.default', onPageEnter);
		bindPageEvent(pageid, 'exit.default', onPageExit);

	});
}

function setActiveMode(mode) {
	activeMode = mode;
	var modes = $('#barcodes .modes .mode');
	modes.removeClass('selected');
	modes.filter('.' + mode).addClass('selected');
	localStorage['activeMode'] = mode;
	var caption = activeMode == 'enter' ? 'ΕΙΣΟΔΟΣ' : 'ΕΞΟΔΟΣ';
	if(keepMode != activeMode) caption += "\nΜόνο η επόμενη κίνηση";
	$('#btnbarcode').val(caption);
}

function setKeepMode(mode) {
	keepMode = mode;
	activeMode = mode;
	var keeps = $('#barcodes .modes .keep');
	keeps.removeClass('selected');
	keeps.filter('.' + mode).addClass('selected');
	var modes = $('#barcodes .modes .mode');
	modes.removeClass('selected');
	modes.filter('.' + mode).addClass('selected');
	localStorage['activeMode'] = mode;
	localStorage['keepMode'] = mode;
	var caption = activeMode == 'enter' ? 'ΕΙΣΟΔΟΣ' : 'ΕΞΟΔΟΣ';
	if(keepMode != activeMode) caption += "\nΜόνο η επόμενη κίνηση";
	$('#btnbarcode').val(caption);
}

function onPageEnter(evdata) { 
	//var page = $(this);
	var page = evdata.page;
	var pageid = evdata.pageid;
	//dlog('entered page: #' + page.attr('id'));
	var afs = page.find('.autofocus');
	afs.each(function() { 
		af = $(this);
		if(af.is(':visible')) { 
			af.focus();
			return false; // break;
		}
	});
}

function onPageExit(evdata) { 
	var page = $(this);
	//dlog('exited page: #' + page.attr('id'));
}

function activatePage(pageid) {
	var pages = $('#pages > .page');
	var currentpage = pages.filter('.current');
	var evdata = { allow: true };
	currentpage.each(function() {
		var page = $(this);
		evdata.pageid = page[0].id;
		evdata.page = page;
		triggerPageEvent(page[0].id, 'exit', evdata);
		if(!evdata.allow) return false; // break
	});
	if(!evdata.allow) return false;
	currentpage.removeClass('current');

	var page = $('#pages > #' + pageid);
	page.addClass('current');
	triggerPageEvent(pageid, 'enter', { pageid: pageid, page: page });
	return true;
}

function getCurrentPageId() {
	var hash = window.location.hash.substr(1);
	if(!hash) return 'home';
	var parts = hash.split('.');
	if(parts.length > 0) { 
		return parts[0];
	}
	return 'home';
}

function getCurrentPage() { 
	var pageid = getCurrentPageId();
	return $('#' + pageid);
}

function hashChanged() {
	var pageid = getCurrentPageId();
	if(!activatePage(pageid)) { 
		window.location.hash = '#' + lastHash;
	}
	lastHash = window.location.hash.substr(1);
}

function selectPage(pageid) {
	window.location.hash = '#' + pageid;
}

function bindPageEvent(pageid, eventnameandclass, callback) {
	var pagerec = pageEvents[pageid];
	if(!pagerec) { 
		pagerec = pageEvents[pageid] = {};
	}
	var callbacks = pagerec[eventnameandclass];
	if(!callbacks) { 
		callbacks = pagerec[eventnameandclass] = [];
	}
	callbacks.push(callback);
}

function triggerPageEvent(pageid, eventnameandclass, data) { 
	var pagerec = pageEvents[pageid];
	if(!pagerec) return ;
	var pageel = $('#' + pageid);
	if(!pageel.length) return;
	pageel = pageel[0];
	for(en in pagerec) { 
		if(en.substr(0, eventnameandclass.length) == eventnameandclass) { 
			var callbacks = pagerec[en];
			if(!callbacks) continue;
			for(var i = 0; i < callbacks.length; i++) { 
				var callback = callbacks[i];
				if(!callback) return ;
				var ret = callback.apply(pageel, [data]);
				if(ret === false) break;
			}
		}
	}
}

function unbindPageEvent(pageid, eventnameandclass) { 
	var pagerec = pageEvents[pageid];
	if(!pagerec) return ;
	for(en in pagerec) { 
		if(en.substr(0, eventnameandclass.length) == eventnameandclass) { 
			delete pagerec[en];
		}
	}
}

function enterBarcode(usethis) {
	if(typeof usethis == 'undefined') usethis = ''; 
	var fld = $('#fldbarcode');
	var history = $('#barcodes div.history');
	var bigmessage = $('#barcodes div.bigmessage');
	if(usethis) {
		var text = usethis;
	} else {
		var text = fld.val();
		if(!text) return ;
	}

	var wait = checkAndStoreBarcode(text, activeMode == 'enter' ? 1 : -1);
	var now = moment();
	wait.done(function(result, item, lastitem) { 
		var time = moment(item.datetime, 'YYYY-MM-DD HH:mm:ss');
		var barcode = item.barcode; // ή text
		var statusclass = 'error';
		var statustext = '';

		switch (result ){
			case BARCODE_RESULT.BR_OK:
				if(item.inorout == 1) {
					statustext = '<span class="msg">ΕΙΣΟΔΟΣ - ΟΚ</span><span class="details"></span>';
			  } else {
					statustext = '<span class="msg">ΕΞΟΔΟΣ - ΟΚ</span><span class="details"></span>';
			  }
				statusclass = 'ok';
				break;
			case BARCODE_RESULT.BR_EXISTS:
				var secs, mins, hours, before;
				var lasttime = moment(lastitem.datetime, 'YYYY-MM-DD HH:mm:ss');

				secs = now.diff(lasttime, 'seconds');
				//mins = Math.trunc(secs / 60);
				mins = (secs/60) - (secs/60) % 1;    // http://stackoverflow.com/a/11290969
				secs = secs % 60;
				//hours = Math.trunc(mins / 60);
				hours = (mins/60) - (mins/60) % 1;   // http://stackoverflow.com/a/11290969
				mins = mins % 60;
				if(secs > 0) {
					before = '' + secs + "''";
				} else {
					before = '';
				}
				if(hours || mins) before = '' + mins + "' " + before;
				if(hours) before = '' + hours + (hours == 1 ? ' ώρα ' : ' ώρες ') + before;
				if(item.inorout == 1) { 
					statustext = '<span class="msg">ΕΧΕΙ ΕΙΣΕΛΘΕΙ ΗΔΗ!</span> <span class="details">(Στις ' + lasttime.format("H:mm:ss") + ' δηλαδή πριν ' + before + ')</span>';
				} else {
					statustext = '<span class="msg">ΕΧΕΙ ΕΞΕΛΘΕΙ ΗΔΗ!</span> <span class="details">(Στις ' + lasttime.format("H:mm:ss") + ' δηλαδή πριν ' + before + ')</span>';
				}
				break;
			case BARCODE_RESULT.BR_UNKNOWN_ERROR:
				statustext = '<span class="msg">ΑΓΝΩΣΤΟ ΠΡΟΒΛΗΜΑ</span>';
				break;
			case BARCODE_RESULT.BR_INVALID_LENGTH:
				statustext = '<span class="msg">ΛΑΘΟΣ ΜΕΓΕΘΟΣ BARCODE</span>';
				break;
			case BARCODE_RESULT.BR_INVALID_SHOW:
				statustext = '<span class="msg">ΛΑΘΟΣ ΠΑΡΑΣΤΑΣΗ</span>';
				break;
			case BARCODE_RESULT.BR_INVALID_TRANSACTION:
				statustext = '<span class="msg">ΛΑΘΟΣ ΚΩΔΙΚΟΣ ΣΥΝΑΛΛΑΓΗΣ</span>';
				break;
			case BARCODE_RESULT.BR_NOT_EXPECTED:
				statustext = '<span class="msg">ΔΕΝ ΠΕΡΙΜΕΝΟΥΜΕ ΤΕΤΟΙΟ ΕΙΣΙΤΗΡΙΟ</span>';
				break;
			case BARCODE_RESULT.BR_INVALID_CONTENT:
				statustext = '<span class="msg">ΜΗ ΕΓΚΥΡΟ BARCODE</span>';
				break;
			default:
				statustext = '<span class="msg">ΜΗ ΑΝΑΜΕΝΟΜΕΝΟ ΠΡΟΒΛΗΜΑ</span> <span class="details">(' + result + ')</span>';
				break;
		}
		var html = [];

		html.push("<div class='entry " + statusclass + "'>");
		html.push("<span class='time'>" + now.format('H:mm:ss') + "</span>");
		html.push("<span class='number'>" + barcode + "</span>");
		html.push("<span class='status'>" + statustext + "</span>");
		html.push("</div>");
		html = html.join("");

		history.prepend($(html));

		bigmessage.html("<span class='barcode'>" + barcode + "</span>" + statustext).removeClass('ok').removeClass('error').addClass(statusclass);

		fld.val('');
		fld.focus();

		setActiveMode(keepMode); // ωστε ακόμα και αν είχαμε προσωρινά επιλέξει άλλο τύπο, να επαναφερθεί σε αυτό που θέλουμε μόνιμα.

	});

	wait.fail(function(e) { 
		alert('Πρόβλημα΄στην εγγραφή. Δοκιμάστε πάλι!');
		dlog(e);
	});
	

}




var STR_PAD_LEFT = 1;
var STR_PAD_RIGHT = 2;
var STR_PAD_BOTH = 3;

function pad(str, len, pad, dir) {

    if (typeof(len) == "undefined") { var len = 0; }
    if (typeof(pad) == "undefined") { var pad = ' '; }
    if (typeof(dir) == "undefined") { var dir = STR_PAD_RIGHT; }

    if (len + 1 >= str.length) {

        switch (dir){

            case STR_PAD_LEFT:
                str = Array(len + 1 - str.length).join(pad) + str;
            break;

            case STR_PAD_BOTH:
                var right = Math.ceil((padlen = len - str.length) / 2);
                var left = padlen - right;
                str = Array(left+1).join(pad) + str + Array(right+1).join(pad);
            break;

            default:
                str = str + Array(len + 1 - str.length).join(pad);
            break;

        } // switch

    }

    return str;

}

var serverMessageCount = 0;

function server(action, params, callback) { 

	var wait = new $.Deferred();
	var ignoreResult = false;

	var msgid = ++serverMessageCount;

	wait.done(function(result) { 
		if(ignoreResult) return ;
		$('#frame_' + msgid).remove();
		$('#form_' + msgid).remove();
		//dlog('server() result: ', result);
		if(typeof callback !== 'undefined') callback(result);
	});
	wait.fail(function(result) { 
		$('#frame_' + msgid).remove();
		$('#form_' + msgid).remove();
		if(ignoreResult) return ;
		if(typeof result == 'undefined') result = {};
		if(! ('status' in result)) { 
			result.status = 'error';
		}
		if(! ('error' in result)) { 
			result.error = 'Failed to contact server';
		}
		if(typeof callback !== 'undefined') callback(result);
	});

	var timeout = setTimeout(function() { 
		// Εδώ πρέπει να πω ότι failed με error "timeout" και να ορίσω ότι ακόμα κι αν έρθει result να αγνοηθεί
		$('#frame_' + msgid).remove();
		$('#form_' + msgid).remove();
		ignoreResult = true;
		$(window).off('message.' + msgid);
		var result = { result: 'error', error: 'timeout' };
		wait.reject(result);
		if(typeof callback !== 'undefined') callback(result);
	}, 5000);


	$(window).on('message.' + msgid, function(e) { 
		var data = e.originalEvent.data;
		if(data['_postid'] != msgid) return ; // δεν είναι το δικό μου
		//dlog('Message: ', e);
		dlog('action result: ', data);
		clearTimeout(timeout);
		$('#frame_' + msgid).remove();
		$('#form_' + msgid).remove();
		$(window).off('message.' + msgid);
		wait.resolve(data);
	});

	// Και φτιάχνω ένα hidden frame για να κάνω POST το action
	var frame = [];
	frame.push("<iframe id='frame_" + msgid + "' name='frame_" + msgid + "'></iframe>");
	frame = $(frame.join(""));

	// Φτιάχνω και την φόρμα που θα κάνει POST
	var form = [];
	form.push("<form id='form_" + msgid + "' method='post' action='http://www.ticketservices.gr/ticket/server/?action=" + action + "' target='frame_" + msgid + "'>" );
	form.push("<input type='hidden' id='postid_" + msgid + "' name='_postid' value='" + msgid + "'>");
	form.push("<input type='hidden' id='postparent_" + msgid + "' name='_postparent' value='1'>");
	form.push("<input type='hidden' id='params_" + msgid + "' name='json_params' value=''>");
	form.push("</form");
	form = $(form.join(""));
	form.find('#params_' + msgid).val(JSON.stringify(params));
	
	$('body').append(frame).append(form);

	form.submit();

	//dlog($('#frame_' + msgid));

	return wait;
}

function serverPing() { 
	dlog('pinging server...');
	server('ping', {param1: 'this is a test'}, function(result) { 
		dlog('ping result: ', result);
	});
}

function checkAndSetTerminal(code, callback) { 
	if(!code) { 
		callback( { result: 'error', error: 'missing_code', msg: 'Δεν ορίσατε κωδικό τερματικού!'})
		return ;
	}
	server('getbarcodeterminal', { code: code }, function(result) { 
		if(result.status == 'error') { 
			if(result.error == 'timeout') { result.msg = 'Πρόβλημα στην επικοινωνία με τον server (timeout)'; }
			else if(result.error == 'not_found') { result.msg = 'Ο κωδικός "' + code + '" δεν βρέθηκε'; }
			else { result.msg = 'Πρόβλημα: ' + result.error; }
		} else { 
			setTerminal(result.code, result.id, result.name);
			//window.location.reload();
		}
		if(typeof callback != 'undefined') {
			callback(result);
		} else { 
			if(result.msg) alert(result.msg);
		}
	});

}

function setTerminal(code, id, name) { 
	TERMINAL = { id: id, code: code, name: name };
	localStorage['terminal'] = JSON.stringify(TERMINAL);
}

function readTerminal() { 
	var ret;
	var srec = localStorage['terminal'];

	if(!srec) {
		return  {
			id : 0,
			code : '',
			name : 'Δεν έχει οριστεί'
		}
	}

	return JSON.parse(srec);
}

var synchronizing = false;

function startSynchronizing() { 
	if(synchronizing) return false;
	synchronizing = true;
	$('body').addClass('syncronizing');
	return true;
}

function stopSynchronizing() { 
	synchronizing = false;
	$('body').removeClass('syncronizing');
}

function synchronize() {
	var statusDiv = $('#barcodes .synchronize .status');
	var wait = new $.Deferred();
	// Αν γίνεται ήδη συγχρονισμός δεν θα κάνω τώρα...
	if(!startSynchronizing()) return ;
	statusDiv.html('Έλεγχος τοπικών εγγραφών...');

	// Θα κρατήσω τι ώρα είναι τώρα, ώστε μετά να διαγράψω όλες τις εγγραφές, εκτός από αυτές που τυχόν έβαλα κατα την διάρκεια του synchronization!!!
	var startedtime = moment().format('YYYY-MM-DD HH:mm:ss');

	// Φορτώνω όσες εγγραφές ΔΕΝ έχουν serverid
	var listWait = entriesList(isItemNotInServer);

	listWait.done(function(list) { 
		// Εδώ έχω ένα list με τις εγγραφές που θέλω να στείλω στον server
		statusDiv.html('Γίνεται επικοινωνία με τον server. Τοπικές εγγραφές που στέλνονται: ' + list.length);
		var params = { 
										barcodeterminalid: TERMINAL.id, 
										items: list, 
										showids: activeShowIds, 
										wantsoldtickets: switches['barcodes_specific'],
										wanttransidshowidseatid: switches['barcode_transcode_showid_seatid']
									}
		server('barcodesynchronize', params, function(result) { 
			if(result.status == 'error') { 
				statusDiv.html('Πρόβλημα στην επικοινωνία: ' + result.error);
				dlog(result);
				stopSynchronizing();
				wait.reject();
				return;
			}
			// Εδώ ο server έχει πάρει τις εγγραφές μου και τις έχει αποθηκεύσει (και τους έχει δώσει και serverid (το id στον πίνακα barcodes_entries))
			// και επιπλέον μου στέλνει και όλες τις εγγραφές που έχει αυτός για τα activeShowIds μου μαζί με αυτά που του έστειλα
			statusDiv.html('Έγινε λήψη ' + result.serverentries.length + ' νέων εγγραφών. Διαγραφή παλαιότερων... ');
			
			// Διαγράφω τα πάντα, για να καταχωρήσω αυτά που έστειλε ο server. ΑΛΛΑ, θα κρατήσω και τυχόν εγγραφές
			// που γίναν όση ώρα διαρκούσε το barcodesynchronize, γιατί αυτές δεν τις έχω στείλει στον server
			var clearWait = entriesClear(startedtime);
			clearWait.done(function() { 
				statusDiv.html('Έγινε διαγραφή των τοπικών στοιχείων. Αρχίζει η καταχώρηση των ' + result.serverentries.length + ' νέων εγγραφών');
				// Εδώ διαγράφτηκαν όλα τα στοιχεία που είχα τοπικά
				// και πάω να καταχωρήσω
				var putWait = entriesPut(result.serverentries);
				putWait.done(function() { 
					stopSynchronizing();
					statusDiv.html('Ολοκληρώθηκε ο συγχρονισμός. Ελήφθησαν ' + result.serverentries.length + ' εγγραφές.');
					wait.resolve();
				});
				putWait.fail(function(e) {
					stopSynchronizing();
					statusDiv.html('Η αποθήκευση των ' + result.serverentries.length + ' εγγραφών που ελήφθησαν απέτυχε.');
					wait.reject();
				});
			});
			clearWait.fail(function(e) { 
				stopSynchronizing();
				statusDiv.html('Η διαγραφή των τοπικών στοιχείων απέτυχε. Ο συγχρονισμός δεν ολοκληρώθηκε.');
				wait.reject();
			});

		});
	});

	listWait.fail(function(e) { 
		statusDiv.html('Αποτυχία ανάγνωσης τοπικών εγγραφών.');
		dlog(e);
		stopSynchronizing();
		wait.reject();
	});

	return wait;
}

function isItemNotInServer(item) { 
	return item.serverid == 0;
}

function readShowsFromLocalStorage() { 
	try {
		shows = JSON.parse(localStorage['shows']);
	} catch(e) { 
		shows = {};
	}

	activeShowIds = [];
	allShowsCount = 0;
	for(showid in shows) { 
		allShowsCount++;
		var show = shows[showid];
		if(show.active) activeShowIds.push(showid);
	}

	dlog('shows: ', shows);
	dlog('activeShowIds.length: ', activeShowIds.length);
}

function writeShowsToLocalStorage() { 
	localStorage['shows'] = JSON.stringify(shows);
}

function fillShowsInSetActiveShows() { 
	var now = moment().startOf('day'); // 00:00 σήμερα
	var tableHeader =  $('#setactiveshows table.showsheader');
	var tableData = $('#setactiveshows table.showsdata');
	tableData.html("");
	var cnt = 0;
	for(showid in shows) { 
		var show = shows[showid];
		var showdt = moment(show.date, 'DD-MM-YY');
		if(showdt.isAfter(now)) {
			var showclass = 'future';
		} else {
			var showclass = 'older';
		}
		var tr =	"<tr class='show" + (show.active ? ' active' : '') + " " + showclass + "' data-showid='" + showid + "'>"
						+	"<td class='check'><input type='checkbox' " + (show.active ? 'checked=checked' : '') + "></td>"
						+ "<td class='showid'>" + showid + "</td>"
						+ "<td class='showday'>" + show.day + "</td>"
						+ "<td class='showdate'>" + show.date + "</td>"
						+ "<td class='showtime'>" + show.time + "</td>" 
						+ "<td class='showtitle'></td>" 
						+ "<td class='showvenue'></td>"
						+ "</tr>";
		tr = $(tr);
		tr.find('.showtitle').text(show.showtitle);
		tr.find('.showvenue').text(show.showvenue);
		tableData.append(tr);
		cnt++;
	}

	if(cnt == 0) { 
		tableHeader.html("Δεν έχουν φορτωθεί παραστάσεις από τον server");
		tableData.html("");
	} else { 
		tableHeader.html("<tr><th class='check'><input type='checkbox'></th> <th class='showid'>ID</th> <th class='showday'>Ημέρα</th> <th class='showdate'>Ημ/νία</th> <th class='showtime'>Ώρα</th> <th class='showtitle'>Τίτλος</th> <th class='showvenue'>Χώρος</th></tr>");
	}


}

function loadShowsFromServer() {
	var msg = $('#setactiveshows .msg'); 
	msg.html('Φόρτωση παραστάσεων...').removeClass('errorText').removeClass('oktext');
	server('barcodesloadshows', { barcodeterminalid: TERMINAL.id }, function(result) { 
		if(result.status == 'error') { 
			msg.html('Πρόβλημα: ' + result.error).addClass('errortext').removeClass('oktext');
			return ;
		}
		if(!result.shows) { 
			msg.html('Πρόβλημα: Ο server δεν επέστρεψε καμία διαθέσιμη παράσταση').addClass('errorText');
			dlog(result);
		}
		shows = {};
		for(var i = 0; i < result.shows.length; i++) { 
			var show = result.shows[i];
			show.active = false;
			shows[show.showid] = show;
		}
		for(var i = 0; i < activeShowIds.length; i++) { 
			var show = shows[activeShowIds[i]];
			if(!show) continue;
			show.active = true;
		}
		writeShowsToLocalStorage();
		readShowsFromLocalStorage();
		fillShowsInSetActiveShows();
		fillActiveShows();
		msg.html('Οι παραστάσεις φορτώθηκαν').removeClass('errortext').addClass('oktext');;

	});
}

function fillActiveShows() { 
	var ul = $('#settings ul.activeShows');
	ul.html('');
	for(var i = 0; i < activeShowIds.length; i++) { 
		var show = shows[activeShowIds[i]];
		if(!show) continue;
		var li = "<li data-showid='" + show.showid + "'>" + show.showid + " " + show.day + " " + show.date + " " + show.time + " " + show.showtitle + " " + show.showvenue + "</li>";
		ul.append(li);
	}
	if(activeShowIds.length < 2) { 
		$('#settings h1.activeShowsHeader').text("Ενεργή παράσταση");
	} else {
		$('#settings h1.activeShowsHeader').text("Ενεργές παραστάσεις (" + activeShowIds.length + ")");
	}
	if(activeShowIds.length == 0) { 
		ul.html("<span class='errortext'>Δεν έχουν επιλεγεί παραστάσεις</a>");
	}

	// Και φτιάχνω και την πληροφορία στο settings - setactiveshows
	$('#setactiveshows #countshowsactive').text(activeShowIds.length);
	$('#setactiveshows #countshowsall').text(allShowsCount);
}

function setSwitch(name, value) { 
	switches[name] = value;
	localStorage['switches'] = JSON.stringify(switches);
}

function applySwitches() { 
	var switch_parents = $('.switch_parent');

	switch_parents.each(function() { 
		var parent = $(this);
		var name = parent.attr('data-field');
		if(!(name in switches)) return ; // continue;
		var children = parent.find('.switch');
		var value = switches[name];
		children.removeClass('selected');
		children.filter('[data-value="' + value + '"]').addClass('selected');
		parent.attr('data-value', value);
	});
}

function readSwitches() { 
	try {
		tmpswitches = JSON.parse(localStorage['switches']);
	} catch(e) { 
		tmpswitches = switches;
	}	
	switches = tmpswitches;
	dlog(switches);
}

function adjustSetActiveShowsDimensions() {
	var div = $('#setactiveshows div.tabledata');
	var pos = div.offset();
	var wh = $(window).height();
	var dh = wh - pos.top;       // pos.top + dh = wh
	div.css('height', (dh - 5) + 'px');
}

function setOnlyFutureShows(value) { 
	$('input#onlyfutureshows').prop('checked', value);
	if(value) { 
		$('#setactiveshows').addClass('onlyfutureshows');
	} else {
		$('#setactiveshows').removeClass('onlyfutureshows');
	}
}