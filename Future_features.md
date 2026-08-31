Claude, please ignore this file, this is a future feature file where I am developing prompts to deliver at at a later date.




### Post calander work
With the 'upcoming' view on the home screen we don't really need the recent activity anymore. Let's remove it



## PWA
### Project Goal

Convert the application from a traditional server-centric web app into a local-first Progressive Web App (PWA) that remains fast and usable even when the home server is unavailable.

Requirements

    The app should install to a phone as a PWA.
    All UI assets (HTML, CSS, JavaScript, images) should be cached locally.
    Core application data should be stored locally on the device using IndexedDB.
    Opening the app should not require contacting the server.
    Users should be able to create, edit and view data while offline.
    Changes made offline should be queued for synchronisation.

Image Storage and Caching

    Store all application metadata and image thumbnails locally on the device.
    Thumbnails should be considered permanent offline data and available without server access.
    Original images should be downloaded only when viewed or when an event containing them is accessed.
    Original images should be stored in a separate cache.
    Original image cache should use least-recently-used (LRU) eviction.
    Original images not accessed within 30 days should be removed automatically.
    Original image cache should be limited to 1GB by default.
    Users should be able to clear the original image cache manually.
    Deleted cached originals should be transparently re-downloaded from the server when needed.

Sync rules:

    Let's keep it simple, but keep the architecture scalable incase we want to add more rules later (eg, data vs wifi, immediate sync). sync should happen daily at 12 AM.
    There should be an option to manually force a sync. This will be in a new settings menu accessible via the bottom bar.

This is a basic plan to convert this app to a PWA. The general idea is to have really speedy access and offline logging that will sync a couple of times a day (or whatever is sensible). Let's make a plan for this functionality.

I have a few questions first.
1. Will this make development slower?? Especially around manual testing?
2. Is this generally a good idea? If I'm using mobile data for instance or have a spotty connection for example



### Push notifications 
Let's add push notifications to the app, The app should notify about upcoming events/appointments/anything with an upcoming date. It should do all events at 9pm the day before, and 9am the morning of. Birthday's should additionally be notified 7 days before the event. For context, this app will be running on a home server on a docker container and will have WAN access via nginx reverse proxy and cloudflare. The site will be called hub.aaronhanna.uk. This is not yet set up as we are still in development phase. Also the app will be behind a passworded page when accessed via WAN. I don;t know if this is relevant but I'm giving you the context just incase.

 Let's plan this. 


### Better search filter
Let's move the AND OR match into the filter tab, and move the categories out of the filter tab so they are displayed by default. So the search should have the keyword search box and the filter on off button on the first row then the Movie, game etc tabs on the second row. Also lets default to flat list, I prefer it.


### ToDo List
I would like a ToDo list tile on the home