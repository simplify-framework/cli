/* This script supports IE9+ */
(function () {
    /* Opening modal window function */
    function openModal(target, callback) {
        var modalWindow = document.getElementById(target);
        modalWindow.classList ? modalWindow.classList.add('open') : modalWindow.className += ' ' + 'open';
        onCloseModal(modalWindow, callback)
        return modalWindow
    }

    function closeModal(modalWindow, callback) {
        modalWindow.classList ? modalWindow.classList.remove('open') : modalWindow.className = modalWindow.className.replace(new RegExp('(^|\\b)' + 'open'.split(' ').join('|') + '(\\b|$)', 'gi'), ' ');
        callback && callback(modalWindow)
    }

    function onCloseModal(modalWindow, callback) {
        /* Get close button */
        var closeButton = document.getElementsByClassName('jsModalClose');
        var closeOverlay = document.getElementsByClassName('jsOverlay');

        /* Set onclick event handler for close buttons */
        for (var i = 0; i < closeButton.length; i++) {
            closeButton[i].onclick = function () {
                closeModal(modalWindow, callback)
            }
        }

        /* Set onclick event handler for modal overlay */
        for (var i = 0; i < closeOverlay.length; i++) {
            closeOverlay[i].onclick = function () {
                var modalWindow = this.parentNode;
                modalWindow.classList ? modalWindow.classList.remove('open') : modalWindow.className = modalWindow.className.replace(new RegExp('(^|\\b)' + 'open'.split(' ').join('|') + '(\\b|$)', 'gi'), ' ');
            }
        }

    }

    /* Triggering modal window function after dom ready */
    window.openModal = openModal;
    window.closeModal = closeModal;
}());
