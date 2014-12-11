var _ = require('lodash');
var EventEmitter = require('events').EventEmitter;
var ThemeProperties = require('./core/boot/ThemeProperties');
var Extras = require('./core/util/Extras');
var Endpoints = require('./core/extensions/ajax/Endpoints');
var Express = require('express');
var NunjucksMongoose = require('nunjucks-mongoose');
var CompositeController = require('./core/util/CompositeController');
var Installer = require('./core/boot/Installer');
var UIFactory = require('./core/util/UIFactory');
var MainEventHandler = require('./core/util/MainEventHandler');
var Gateways = require('./core/checkout/Gateways');
var DynamicFileSystemLoader = require('./core/loader/DynamicFileSystemLoader');
var Directory = require('./core/boot/Directory');
var ModelCompiler = require('./core/models/ModelCompiler');
var ModelCompilerSyntax = require('./core/models/ModelCompilerSyntax');
var Mediator = require('./core/boot/Mediator');
var ThemeSelection = require('./core/boot/ThemeSelection');
var ThemePreLoader = require('./core/boot/ThemePreLoader');
var SettingsPreLoader = require('./core/boot/SettingsPreLoader');
var Configuration = require('./core/boot/Configuration.js');
var Environment = require('./core/boot/Environment');
/**
 * EStore is the main constructor for the system.
 *
 * The object from this constructor is currently passed around everywhere
 * and maybe abused in various places.
 *
 * @todo
 * 1 Turn the object into a factory class to avoid leaking abstraction.
 * 2 Pass more work to smaller enscapulated object.
 *
 * @constructor
 * @alias EStore
 *
 */
module.exports = function EStore() {

	var modelCompiler = new ModelCompiler(new ModelCompilerSyntax());
	var config = new Configuration(process.env);
	var installer = new Installer(this, config, modelCompiler);
	var bus = new EventEmitter();
	var extensions = [];


	this.settingFields = {};
	this.runnableSettings = [];
	this.daemons = [];
	this.validators = {};

	//Settings
	this.MAX_TRANSACTIONS_PROCESSED = 10;
	this.TRANSACTION_DAEMON_INTERVAL = 10000;
	this.INVOICE_DAEMON_INTERVAL = 5000;

	//Events
	this.ROUTE_REGISTRATION = 'Route Registration';
	this.SETTINGS_CHANGED = 'Settings Changed';
	this.TRANSACTION_APPROVED = 'TRANSACTION_APPROVED';
	this.TRANSACTION_DECLINED = 'TRANSACTION_DECLINED';
	this.SYSTEM_ERROR = 'runtime error';
	this.CATEGORY_CREATED = 'category created';
	this.CUSTOMER_CREATED = 'customer created';
	this.CUSTOMER_ACTIVATED = 'customer activated';
	this.CUSTOMER_SIGNED_IN = 'customer signed in';
	this.QUERY_ERROR = 'query error';
	this.NOTIFICATION = 'notify';
	this.OUTBOUND_MAIL = 'OUTBOUND_MAIL';
	this.ENQUIRY = 'ENQUIRY';
	this.SERVER_STARTED = 'SERVER_STARTED';


	//Constants
	this.STATUS_SYSTEM_ERROR = 503;
	this.STATUS_CLIENT_ERROR = 409;
	this.STATUS_OPERATION_COMPLETE = 201;

	/**
	 * locals
	 *
	 * @property
	 * @type {Object}
	 */
	this.locals = {};


	/**
	 * settings contains the settings
	 *
	 * @property settings
	 * @type {Object}
	 */
	this.settings = {};

	/**
	 *
	 * @property {Application}
	 *
	 */
	this.app = new Express();

	/**
	 *
	 * @property {Keystone} keystone
	 *
	 *
	 */
	this.keystone = require('keystone');

	/**
	 *
	 * @property {Environment} viewEngine
	 *
	 */
	this.viewEngine = undefined;

	/**
	 * gateways is an object containing the gateway modules that are enabled.
	 *
	 * @property gateways
	 * @type {Object}
	 */
	this.gateways = new Gateways();

	/**
	 * engines
	 *
	 * @property engines
	 * @type
	 */
	this.engines = {};


	/**
	 * endpoints is an object with the api endpoints for the app.
	 * TODO: In the future, this may be an external package so it can be reused onGateways
	 * the client side.
	 * @property endpoints
	 * @type {Object}
	 */
	this.endpoints = new Endpoints();

	/**
	 * composite
	 *
	 * @property composite
	 * @type {CompositeController}
	 */
	this.composite = new CompositeController();

	this.mediator = new Mediator(this);

	/**
	 * _preloadThemes
	 *
	 * Gather a list of available themes, remove any
	 * that are blacklisted (if implemented).
	 *
	 * @method _preloadThemes
	 * @return
	 *
	 */
	this._preloadThemes = function() {

		var selection = new ThemeSelection();
		var loader = new ThemePreLoader(selection);
		loader.load(__dirname + '/themes');
		this._templates = selection.getSelection();

	};

	/**
	 * _preloadSettings
	 *
	 * @method _preloadSettings
	 * @param {Function} cb
	 * @return  {Promise}
	 *
	 */
	this._preloadSettings = function() {

		var loader =
			new SettingsPreLoader(Environment.getMongoURI(),
				this.mediator);

		return loader.load();
	};

	/**
	 * _bootstrapTheme
	 *
	 * @method _bootstrapTheme
	 * @return
	 *
	 */
	this._bootstrapTheme = function() {

		var path;

		if (this.settings.theme)
			path = this.settings.theme.current;

		if (!path)
			path = config.get('DEFAULT_THEME', 'themes/default');

		config.setThemeProperties(
			new ThemeProperties(__dirname + '/' + path));

	};

	/**
	 * _bootstrapNunjucks
	 *
	 * @method _bootstrapNunjucks
	 * @return
	 *
	 */
	this._bootstrapNunjucks = function() {

		var nunjucks = require('nunjucks');
		this.loader = new DynamicFileSystemLoader(config.getThemeProperties());
		this.viewEngine = new nunjucks.Environment(
			this.loader, {
				autoescape: true,
				tags: {
					variableStart: '<$',
					variableEnd: '$>'
				}
			});

		this.viewEngine.addFilter('subtotal', require('./core/filters/subtotal'));
		this.viewEngine.addFilter('delivery', require('./core/filters/delivery'));
		this.viewEngine.addFilter('total', require('./core/filters/total'));
		this.viewEngine.express(this.app);


	};


	/**
	 * _boostrapKeystone
	 *
	 * @method _boostrapKeystone
	 * @return
	 *
	 */
	this._boostrapKeystone = function() {

		var theme = config.getThemeProperties();

		this.keystone.init();
		this.keystone.set('name', config.get('BRAND', 'EstoreJS'));
		this.keystone.set('brand', config.get('BRAND', 'EstoreJS'));
		this.keystone.set('auto update', true);
		this.keystone.set('session', true);
		this.keystone.set('session store', 'mongo');
		this.keystone.set('auth', true);
		this.keystone.set('cookie secret', Environment.getCookieSecret());
		this.keystone.set('view engine', 'html');
		this.keystone.set('static', theme.statics());
		this.keystone.set('emails', theme.emails());
		this.keystone.set('port', config.get('PORT', 3000));
		this.keystone.set('mongo', Environment.getMongoURI());
		this.keystone.set('user model', 'User');

		this.viewEngine.addExtension('NunjucksMongoose',
			new NunjucksMongoose(this.keystone.mongoose, 'get'));

		this.keystone.connect(this.app);


	};

	/**
	 * _gatherExtensions
	 *
	 * @method _gatherExtensions
	 * @return
	 *
	 */
	this._gatherExtensions = function() {

		var pkg = config.
		getThemeProperties().
		getProperties();

		extensions.push(require('./core/extensions/routes'));
		extensions.push(require('./core/extensions/payments/cod'));
		extensions.push(require('./core/extensions/payments/bank'));
		extensions.push(require('./core/extensions/payments/cheque'));
		extensions.push(require('./core/extensions/daemons/transaction'));
		extensions.push(require('./core/extensions/engines/image'));
		extensions.push(require('./core/extensions/models/user'));
		extensions.push(require('./core/extensions/models/counter'));
		extensions.push(require('./core/extensions/models/item'));
		extensions.push(require('./core/extensions/models/invoice'));
		extensions.push(require('./core/extensions/models/product'));
		extensions.push(require('./core/extensions/models/category'));
		extensions.push(require('./core/extensions/models/transaction'));
		extensions.push(require('./core/extensions/models/country'));

		if (config.get('MANDRILL_API_KEY'))
			extensions.push(require('./core/extensions/services/mandrill'));

		if (config.get('S3_KEY'))
			if (config.get('S3_SECRET'))
				if (config.get('S3_BUCKET'))
					extensions.push(
						require('./core/extensions/engines/imageS3'));

		if (config.get('CLOUDINARY_URL'))
			if (config.get('CLOUDINARY_SECRET'))
				extensions.push(
					require('./core/extensions/engines/imageCloudinary'));

		if (pkg.supports.blog)
			extensions.push(require('./core/extensions/blog'));

		if (pkg.supports.pages)
			extensions.push(require('./core/extensions/pages'));

		if (pkg.supports.contact)
			extensions.push(require('./core/extensions/contact'));


		if (pkg.ajax) {

			if (pkg.ajax.checkout)
				extensions.push(require('./core/extensions/ajax/checkout'));

			if (pkg.ajax.products)
				extensions.push(require('./core/extensions/ajax/products'));

			if (pkg.ajax.cart)
				extensions.push(require('./core/extensions/ajax/cart'));
		}

		if (pkg.supports)
			if (pkg.supports.customers)
				extensions.push(require('./core/extensions/customers'));

		var extras = new Directory(__dirname + '/extras/extensions');
		extras.forEachDirectory(function(path) {

			extensions.push(require(path));

		}.bind(this));

		extensions.forEach(function(ext) {

			if (typeof ext.settings === 'object')
				installer.settings(ext.settings);

		}.bind(this));



	};

	/**
	 * _registerSettingsDataModel
	 *
	 * @method _registerSettingsDataModel
	 * @return
	 *
	 */
	this._registerSettingsDataModel = function() {

		var settings = require('./core/extensions/models/settings');
		var fields = settings.model(this, this.keystone.Field.Types);

		fields.push.apply(this.settingFields);

		var list = new this.keystone.List('Settings', settings.options);

		list.add.apply(list, fields);
		settings.run(list, this);

		this.runnableSettings.forEach(function(f) {
			f(list, this.keystone.Field.Types);
		}.bind(this));

		list.register();

		this.settings = this.keystone.list('Settings').model(this.settings).toObject();

	};

	/**
	 * _processExtensions
	 *
	 * @method _processExtensions
	 * @return
	 *
	 */
	this._processExtensions = function() {

		extensions.forEach(function(ext) {

			installer.install(ext);

		}.bind(this));

	};


	/**
	 * _scanPages scans the theme package file for pages support.
	 *
	 * @method _scanPages
	 * @return
	 *
	 */
	this._scanPages = function() {

		var pages = config.getThemeProperties().
		getProperties().
		supports.pages;

		if (!pages)
			return;

		this.pages = {
			templates: []
		};

		Object.keys(pages.templates).forEach(function(key) {

			this.pages.templates.push({
				value: pages.templates[key],
				label: key
			});

		}.bind(this));

	};


	/**
	 * _modelRegistration registers the keystone models.
	 *
	 * @method _modelRegistration
	 * @return
	 *
	 */
	this._modelRegistration = function() {
		modelCompiler.compile(this);
	};


	/**
	 * _eventRegistration
	 *
	 * @method _eventRegistration
	 * @return
	 *
	 */
	this._eventRegistration = function() {

		var handler = new MainEventHandler(this);
		handler.handleEvents(this.bus);

	};

	/**
	 * _buildGatewayList
	 *
	 * @method _buildGatewayList
	 * @return
	 *
	 */
	this._buildGatewayList = function() {

		var self = this;

		this.gateways.list.length = 0;

		this.gateways.available.forEach(function(gw) {

			if (gw.workflow === 'card') {

				if (gw.value === self.settings.payments.card.active) {
					self.gateways.active.card = gw;
					self.gateways.list.push({
						label: 'Credit Card',
						value: 'card'
					});
				}

			} else {
				if (self.settings.payments[gw.key])
					if (self.settings.payments[gw.key].active === true) {
						self.gateways.active[gw.workflow] = gw;
						self.gateways.list.push({
							label: gw.label,
							value: gw.workflow
						});


					}



			}




		});

	};

	/**
	 * _routeRegistration registers the routes.
	 *
	 * @method _routeRegistration
	 * @return
	 *
	 */
	this._routeRegistration = function() {

		var self = this;


		/** Temporary hack to ensure CSRF protection for EStore routes **/
		this.keystone.pre('routes', function(req, res, next) {
			if (process.env.DISABLE_CSRF)
				return next();
			if (req.originalUrl.match(/^\/keystone/))
				return next();

			Express.csrf()(req, res, function(err) {
				//This prevents 403 errors from being thrown after the csrf middleware.
				if (err) return res.send(403);
				next();
			});

		});

		this.keystone.pre('routes', function(req, res, next) {
			if (!process.env.DISABLE_CSRF) {
				res.locals._csrf = res.locals._csrf || req.csrfToken && req.csrfToken();
				res.cookie('XSRF-TOKEN', res.locals._csrf);
			}
			next();

		});
		/** end hack **/

		this.keystone.pre('routes', function(req, res, next) {

			//Set some useful variables.
			res.locals.$user = req.session.user;
			res.locals.$customer = req.session.customer;
			res.locals.$settings = this.settings;
			res.locals.$query = req.query;
			res.locals.$domain = req.get('host');
			res.locals.$url = req.protocol + '://' + req.get('Host') + req.url;
			res.locals.$categories = this.locals.categories;
			res.locals.$navigation = this._navigation;
			req.session.cart = req.session.cart || [];
			res.locals.$cart = req.session.cart;
			res.locals.$currency = this.settings.currency;
			req.session.pendingTransactions = req.session.pendingTransactions || [];
			next();

		}.bind(this));

		this.keystone.set('routes', function(app) {

			this.composite.routeRegistration(app);

		}.bind(this));

	};

	/**
	 * _startDaemons starts the daemons.
	 *
	 * @method _startDaemons
	 * @return
	 *
	 */
	this._startDaemons = function() {

		this.daemons.forEach(function(daemon) {

			setInterval(daemon.exec(this), daemon.interval);

		}.bind(this));

	};


	/**
	 * _fetchCategories
	 *
	 * @method _fetchCategories
	 * @return
	 *
	 */
	this._fetchCategories = function() {

		this.keystone.list('Category').model.
		find().
		lean().
		populate('children').
		exec().
		then(function(categories) {
			this.locals.categories = categories;
		}.bind(this));

	};

	/**
	 * start estore
	 * @method start
	 * @return
	 *
	 */
	this.start = function(cb) {

		var self = this;
		self._preloadThemes();

		return self._preloadSettings().
		then(function() {
			self._bootstrapTheme();
			self._bootstrapNunjucks();
			self._boostrapKeystone();
			self._gatherExtensions();
			self._registerSettingsDataModel();
			self._processExtensions();
			self._scanPages();
			self._modelRegistration();
			self._buildGatewayList();
			self._eventRegistration();
			self._routeRegistration();
			self._startDaemons();
			self.keystone.start(function() {

				self._fetchCategories();
				self.broadcast(self.SERVER_STARTED, self);
				if (cb) cb();

			});

		}).done(function(err) {
			if (err) throw err;
		});

	};

	/**
	 * install an extension.
	 *
	 * @method install
	 * @param {Object} ext An object declaring an extension.
	 * @return
	 *
	 */
	this.install = function(ext) {

		installer.install(ext);

	};

	/**
	 * addEventListener puts a callback on the internal
	 * event bus.
	 *
	 * @method addEventListener
	 * @param {String} event
	 * @param {Function} cb
	 * @param {Boolean} once
	 * @return
	 *
	 */
	this.addEventListener = function(event, cb, once) {

		if (once)
			bus.once(event, cb);

		if (!once)
			bus.on(event, cb);

		return this;

	};

	/**
	 * broadcast an event on the internal bus.
	 *
	 * TODO: Stop using bus.emit and use this instead.
	 * @method broadcast
	 * @return
	 *
	 */
	this.broadcast = function() {
		console.log('DEBUG: Event ', arguments[0]);
		bus.emit.apply(bus, arguments);
	};

	/**
	 * getKeystone returns the keystonejs singleton.
	 *
	 * @method getKeystone
	 * @instance
	 * @deprecated
	 * @return {external:Keystone}
	 *
	 */
	this.getKeystone = function() {
		console.log('Estore.getKeystone is deprecated');
		return this.keystone;
	};


	/**
	 * getDataModel is a factory method for getting a model from keystone.
	 *
	 * @method getDataModel
	 * @param {String} name
	 * @param {Boolean} create
	 * @param {Object} args
	 * @return {Function}
	 *
	 */
	this.getDataModel = function(name, create, args) {

		if (!create)
			return this.keystone.list(name).model;

		var Model = this.getDataModel(name);
		return new Model(args);

	};

	/**
	 * getGateways returns the list of gateways in a helpful wrapper.
	 *
	 * @method getGateways
	 * @return
	 *
	 */
	this.getGateways = function() {

		return this.gateways;
	};

	/**
	 * getRenderCallback provides a handy callback for rendering templates.
	 *
	 * @method getRenderCallback
	 * @instance
	 * @return {Function}
	 *
	 */
	this.getRenderCallback = function() {

		return require('./core/util/render');

	};


	/**
	 * getViewEngine returns the installed view engine.
	 *
	 * @method getViewEngine
	 * @instance
	 * @return {Object}
	 *
	 */
	this.getViewEngine = function() {

		return this.viewEngine;

	};


};
