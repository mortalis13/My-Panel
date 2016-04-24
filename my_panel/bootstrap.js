const { classes: Cc, interfaces: Ci, utils: Cu } = Components;

Cu.import("resource://gre/modules/AddonManager.jsm");
Cu.import("resource://gre/modules/Home.jsm");
Cu.import("resource://gre/modules/HomeProvider.jsm");
Cu.import("resource://gre/modules/Messaging.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/Task.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

const ADDON_ID = "my-panel@toolbar.org";
const PANEL_ID = "my.panel@toolbar.org";
const DATASET_ID = "my.dataset@toolbar.org";
const DATA_URL = "chrome://my-panel/content/items.json";

var button,menu;
var path="/storage/emulated/0/1-Install/items.json"

function loadIntoWindow(window) {
	var parentId=window.NativeWindow.menu.toolsMenuID
	menu = window.NativeWindow.menu.add({
		name:"Update My Panel", 
		callback:function(){
			updatePanel(window);
		},
		parent:parentId
	});
}

function unloadFromWindow(window) {
	if (!window) return;
	window.NativeWindow.menu.remove(menu);
}

function updatePanel(window){
	let fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
	fp.init(window, "Select a file", Ci.nsIFilePicker.modeOpen);
	fp.appendFilters(Ci.nsIFilePicker.filterText);								//.txt
	fp.show();

	var selectedFile=fp.file
	if(!selectedFile) return
	var url=Services.io.newFileURI(selectedFile);
	
	var res=[]
	fetchData(url.spec, function(data) {
		var data=data.split(/\r\n/)
		for(var i=0;i<data.length;i++)
			data[i]=data[i].trim()
		data=data.join("\n")
	
		var data=data.split(/\n\n/)
		var res=[]
		
		for(var i=0;i<data.length;i++){
			data[i]=data[i].trim()
			if(data[i]==="") data.splice(i--,1)
		}
		
		for(var i=0;i<data.length;i++){
			var itemData=data[i].split(/\n/)
			var title=itemData[0]
			var url=itemData[1]
			if(itemData.length===1) url=itemData[0]
			
			if(title!=="" && url!==""){
				var item={}
				item.title=title
				item.url=url
				item.description=url
				res.push(item)
			}
		}
		res=JSON.stringify(res)
		
		var dataFile=Services.dirsvc.get("ProfD",Ci.nsIFile)
		dataFile.append("extensions")
		dataFile.append(ADDON_ID)
		dataFile.append("content")
		dataFile.append("items.json")
		if(dataFile.exists()) dataFile.remove(false)

		var file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsILocalFile);
		file.initWithFile(dataFile);
		file.createUnique(Ci.nsIFile.NORMAL_FILE_TYPE,0644);	
		
		var foStream = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
		foStream.init(file, 0x02 | 0x08 | 0x20, 0666, 0); 
		var converter = Cc["@mozilla.org/intl/converter-output-stream;1"].createInstance(Ci.nsIConverterOutputStream);
		converter.init(foStream, "UTF-8", 0, 0);
		converter.writeString(res);
		converter.close(); 
		
		refreshDataset()
	})
}

function optionsCallback() {
  return {
    title: "My Panel",
    views: [{
      type: Home.panels.View.GRID,
      dataset: DATASET_ID,
      onrefresh: refreshDataset
    }],
    onuninstall: function() {
      AddonManager.getAddonByID(ADDON_ID, function(addon) {
        addon.uninstall();
      });
    }
  };
}

function fetchData(url, onFinish) {
  let xhr = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(Ci.nsIXMLHttpRequest);
  try {
    xhr.open("GET", url, true);
  } catch (e) {}
  xhr.onload = function onload(event) {
    if (xhr.status === 200) {
      onFinish(xhr.responseText);
    }
  }
  xhr.send(null);
}

function refreshDataset() {
  fetchData(DATA_URL, function(response) {
    Task.spawn(function() {
      let items = JSON.parse(response);
      let storage = HomeProvider.getStorage(DATASET_ID);
      yield storage.save(items, { replace: true });
    }).then(null, e => Cu.reportError("Error refreshing dataset " + DATASET_ID + ": " + e));
  });
}

function deleteDataset() {
  Task.spawn(function() {
    let storage = HomeProvider.getStorage(DATASET_ID);
    yield storage.deleteAll();
  }).then(null, e => Cu.reportError("Error deleting data from HomeProvider: " + e));
}

function openPanel() {
  Services.wm.getMostRecentWindow("navigator:browser").BrowserApp.addTab("about:home?panel=" + PANEL_ID);
  // Services.wm.getMostRecentWindow("navigator:browser").BrowserApp.loadURI("about:home?panel=" + PANEL_ID);
}

function startup(data, reason) {
  let windows = Services.wm.getEnumerator("navigator:browser");
  while (windows.hasMoreElements()) {
    let domWindow = windows.getNext().QueryInterface(Ci.nsIDOMWindow);
    loadIntoWindow(domWindow);
  }
  Services.wm.addListener(windowListener);

  Home.panels.register(PANEL_ID, optionsCallback);
  switch(reason) {
    case ADDON_INSTALL:
    case ADDON_ENABLE:
      Home.panels.install(PANEL_ID);
      HomeProvider.requestSync(DATASET_ID, refreshDataset);
      break;
    case ADDON_UPGRADE:
    case ADDON_DOWNGRADE:
      Home.panels.update(PANEL_ID);
      break;
  }
  if (reason == ADDON_INSTALL) {
    openPanel();    
  }
}

function shutdown(data, reason) {
  if (reason == ADDON_UNINSTALL || reason == ADDON_DISABLE) {
    Home.panels.uninstall(PANEL_ID);
    deleteDataset();
	
	Services.wm.removeListener(windowListener);
	let windows = Services.wm.getEnumerator("navigator:browser");
	while (windows.hasMoreElements()) {
		let domWindow = windows.getNext().QueryInterface(Ci.nsIDOMWindow);
		unloadFromWindow(domWindow);
	}
  }
  Home.panels.unregister(PANEL_ID);
}

var windowListener = {
  onOpenWindow: function(aWindow) {
    let domWindow = aWindow.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindowInternal || Ci.nsIDOMWindow);
    domWindow.addEventListener("UIReady", function onLoad() {
      domWindow.removeEventListener("UIReady", onLoad, false);
      loadIntoWindow(domWindow);
    }, false);
  },
  onCloseWindow: function(aWindow) {},
  onWindowTitleChange: function(aWindow, aTitle) {}
};
